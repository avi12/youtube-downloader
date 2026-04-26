import type { DownloadResult } from "./background-downloader";
// Parallel chunked-SABR downloader. Replaces seek-through-iframe scrubbing
// with raw-protocol googlevideo POSTs at offset playerTimeMs values.
//
// 1. Decode the captured player-signed VideoPlaybackAbrRequest body.
// 2. Phase 1: replay the captured body verbatim. Decode the UMP response,
//    extract MEDIA bytes per itag (init segments + first ~60s of media),
//    harvest nextRequestPolicy.playbackCookie.
// 3. Phase 2: for each offset (60s, 120s, …), build a fresh request body
//    with mutated clientAbrState.playerTimeMs, bufferedRanges spanning [0..N],
//    and the captured playbackCookie. Send in parallel. Decode responses.
// 4. Concatenate all MEDIA bytes in offset order per itag and return.
//
// This bypasses SabrStream's per-session media quota (which capped a single
// session at ~80s of media) by issuing each offset's fetch as a fresh
// request — the playbackCookie threads them as one logical session from the
// server's view but the per-fetch quota resets.
import { sendProgressUpdate } from "./progress-fetch";
import type { AdaptiveFormatItem, DownloadRequest, SabrConfig } from "@/types";
import { ProgressType } from "@/types";
import {
  type FormatId,
  MediaHeader,
  NextRequestPolicy,
  PlaybackCookie,
  SabrError,
  StreamProtectionStatus,
  UMPPartId,
  VideoPlaybackAbrRequest
} from "googlevideo/protos";
import { CompositeBuffer, UmpReader } from "googlevideo/ump";

const OFFSET_STEP_MS = 60_000;
const MAX_PARALLEL = 4;
const PER_FETCH_TIMEOUT_MS = 30_000;
const MAX_FETCHES_PER_OFFSET = 3;

interface ChunkedTemplate {
  url: string;
  bodyBase64: string;
  capturedAt: number;
}

interface SegmentBytes {
  itag: number;
  sequenceNumber: number;
  segDurationMs: number;
  bytes: Uint8Array;
}

interface DecodedResponse {
  segments: SegmentBytes[];
  playbackCookieBytes?: Uint8Array;
  protectionStatus?: number;
  hasSabrError: boolean;
  totalMediaBytes: number;
}

function compositeBufferToUint8(buffer: CompositeBuffer): Uint8Array {
  const out = new Uint8Array(buffer.totalLength);
  let offset = 0;
  for (const chunk of buffer.chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function decodeBase64(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), char => char.charCodeAt(0));
}

function decodeResponseBody(body: Uint8Array): DecodedResponse {
  const result: DecodedResponse = {
    segments: [],
    hasSabrError: false,
    totalMediaBytes: 0
  };
  const headerById = new Map<number, MediaHeader>();
  const mediaBufsById = new Map<number, Uint8Array[]>();

  const reader = new UmpReader(new CompositeBuffer([body]));
  reader.read((part: {
    type: number;
    size: number;
    data: CompositeBuffer;
  }) => {
    const bytes = compositeBufferToUint8(part.data);
    try {
      switch (part.type) {
        case UMPPartId.MEDIA_HEADER: {
          const header = MediaHeader.decode(bytes);
          if (typeof header.headerId === "number") {
            headerById.set(header.headerId, header);
          }

          break;
        }
        case UMPPartId.MEDIA: {
          if (bytes.length < 2) {
            break;
          }

          const headerId = bytes[0];
          const list = mediaBufsById.get(headerId) ?? [];
          list.push(bytes.subarray(1));
          mediaBufsById.set(headerId, list);
          result.totalMediaBytes += bytes.byteLength - 1;
          break;
        }
        case UMPPartId.NEXT_REQUEST_POLICY: {
          const policy = NextRequestPolicy.decode(bytes);
          if (policy.playbackCookie) {
            result.playbackCookieBytes = PlaybackCookie.encode(policy.playbackCookie).finish();
          }

          break;
        }
        case UMPPartId.SABR_ERROR: {
          SabrError.decode(bytes);
          result.hasSabrError = true;
          break;
        }
        case UMPPartId.STREAM_PROTECTION_STATUS:
          result.protectionStatus = StreamProtectionStatus.decode(bytes).status;
          break;
      }
    } catch {
      // unknown part — ignore
    }
  });

  for (const [headerId, header] of headerById) {
    const bufs = mediaBufsById.get(headerId);
    if (!bufs || bufs.length === 0) {
      continue;
    }

    const total = bufs.reduce((sum, buf) => sum + buf.byteLength, 0);
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const buf of bufs) {
      merged.set(buf, offset);
      offset += buf.byteLength;
    }
    result.segments.push({
      itag: header.itag ?? 0,
      sequenceNumber: header.sequenceNumber ?? 0,
      segDurationMs: parseInt(header.durationMs ?? "0", 10) || 0,
      bytes: merged
    });
  }

  return result;
}

interface FormatProgress {
  itag: number;
  formatId: FormatId;
  segmentBytes: Uint8Array[];
  maxSeq: number;
  totalDurationMs: number;
  inferredSegDurMs: number;
}

function newFormatProgress(formatId: FormatId): FormatProgress {
  return {
    itag: formatId.itag ?? 0,
    formatId,
    segmentBytes: [],
    maxSeq: 0,
    totalDurationMs: 0,
    inferredSegDurMs: 5_000
  };
}

function appendSegment(progress: FormatProgress, segment: SegmentBytes) {
  progress.segmentBytes.push(segment.bytes);

  if (segment.sequenceNumber > progress.maxSeq) {
    progress.maxSeq = segment.sequenceNumber;
  }

  if (segment.segDurationMs > 0) {
    progress.totalDurationMs += segment.segDurationMs;
    progress.inferredSegDurMs = Math.round(progress.totalDurationMs / Math.max(progress.maxSeq, 1));
  }
}

function bufferedRangeFor(progress: FormatProgress, claimedDurationMs: number) {
  const segDur = progress.inferredSegDurMs > 0 ? progress.inferredSegDurMs : 5_000;
  return {
    formatId: progress.formatId,
    startTimeMs: "0",
    durationMs: String(claimedDurationMs),
    startSegmentIndex: 1,
    endSegmentIndex: Math.max(1, Math.floor(claimedDurationMs / segDur))
  };
}

function fetchWithTimeout(url: string, body: Uint8Array, signal: AbortSignal) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PER_FETCH_TIMEOUT_MS);
  signal.addEventListener("abort", () => controller.abort(), { once: true });

  const buffer = new ArrayBuffer(body.byteLength);
  new Uint8Array(buffer).set(body);
  return fetch(url, {
    method: "POST",
    body: buffer,
    credentials: "include",
    signal: controller.signal
  }).finally(() => clearTimeout(timeout));
}

function urlWithRequestNumber(baseUrl: string, requestNumber: number) {
  const url = new URL(baseUrl);
  url.searchParams.set("rn", String(requestNumber));
  return url.toString();
}

function buildContinuationBody({
  decodedTemplate, playerTimeMs, audioProgress, videoProgress,
  audioBufferedDurationMs, videoBufferedDurationMs, playbackCookieBytes
}: {
  decodedTemplate: VideoPlaybackAbrRequest;
  playerTimeMs: number;
  audioProgress: FormatProgress;
  videoProgress: FormatProgress;
  audioBufferedDurationMs: number;
  videoBufferedDurationMs: number;
  playbackCookieBytes?: Uint8Array;
}): Uint8Array {
  const next: VideoPlaybackAbrRequest = {
    ...decodedTemplate,
    clientAbrState: {
      ...(decodedTemplate.clientAbrState ?? {}),
      playerTimeMs: String(playerTimeMs)
    },
    bufferedRanges: [
      bufferedRangeFor(audioProgress, audioBufferedDurationMs),
      bufferedRangeFor(videoProgress, videoBufferedDurationMs)
    ],
    streamerContext: {
      ...(decodedTemplate.streamerContext ?? {
        sabrContexts: [],
        unsentSabrContexts: [],
        clientInfo: undefined
      }),
      playbackCookie: playbackCookieBytes
    }
  };
  return VideoPlaybackAbrRequest.encode(next).finish();
}

async function fetchOffsetWindow({
  decodedTemplate, baseUrl, fromMs, requestNumberSeed, audioFormatId, videoFormatId,
  startCookie, audioCadenceMs, videoCadenceMs, signal, log
}: {
  decodedTemplate: VideoPlaybackAbrRequest;
  baseUrl: string;
  fromMs: number;
  requestNumberSeed: number;
  audioFormatId: FormatId;
  videoFormatId: FormatId;
  startCookie?: Uint8Array;
  audioCadenceMs: number;
  videoCadenceMs: number;
  signal: AbortSignal;
  log: (msg: string) => void;
}): Promise<{
  audioBytes: Uint8Array[];
  videoBytes: Uint8Array[];
}> {
  const audioProgress = newFormatProgress(audioFormatId);
  audioProgress.inferredSegDurMs = audioCadenceMs;
  const videoProgress = newFormatProgress(videoFormatId);
  videoProgress.inferredSegDurMs = videoCadenceMs;
  let cookie = startCookie;
  let requestNumber = requestNumberSeed;

  for (let attempt = 0; attempt < MAX_FETCHES_PER_OFFSET && !signal.aborted; attempt++) {
    const claimedAudio = fromMs + audioProgress.totalDurationMs;
    const claimedVideo = fromMs + videoProgress.totalDurationMs;
    const body = buildContinuationBody({
      decodedTemplate,
      playerTimeMs: claimedAudio,
      audioProgress,
      videoProgress,
      audioBufferedDurationMs: claimedAudio,
      videoBufferedDurationMs: claimedVideo,
      playbackCookieBytes: cookie
    });
    const url = urlWithRequestNumber(baseUrl, requestNumber++);

    let responseBytes: Uint8Array;
    try {
      const response = await fetchWithTimeout(url, body, signal);
      responseBytes = new Uint8Array(await response.arrayBuffer());
    } catch (err) {
      log(`fromMs=${fromMs} attempt=${attempt} fetch threw: ${String(err)}`);
      break;
    }

    const decoded = decodeResponseBody(responseBytes);
    log(
      `fromMs=${fromMs} attempt=${attempt} bytes=${responseBytes.byteLength} `
      + `mediaBytes=${decoded.totalMediaBytes} segments=${decoded.segments.length}`
    );

    if (decoded.hasSabrError || decoded.protectionStatus === 3) {
      break;
    }

    if (decoded.totalMediaBytes === 0) {
      break;
    }

    if (decoded.playbackCookieBytes) {
      cookie = decoded.playbackCookieBytes;
    }

    for (const segment of decoded.segments) {
      if (segment.itag === audioProgress.itag) {
        appendSegment(audioProgress, segment);
      } else if (segment.itag === videoProgress.itag) {
        appendSegment(videoProgress, segment);
      }
    }

    if (audioProgress.totalDurationMs >= OFFSET_STEP_MS && videoProgress.totalDurationMs >= OFFSET_STEP_MS) {
      break;
    }
  }

  return {
    audioBytes: audioProgress.segmentBytes,
    videoBytes: videoProgress.segmentBytes
  };
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

interface Phase1Result {
  audioProgress: FormatProgress;
  videoProgress: FormatProgress;
  cookie?: Uint8Array;
  hadAttestationBlock: boolean;
}

const PHASE1_MAX_FETCHES = 6;

async function runPhase1({
  templateUrl, templateBody, decodedTemplate, audioFormatId, videoFormatId, signal, log
}: {
  templateUrl: string;
  templateBody: Uint8Array;
  decodedTemplate: VideoPlaybackAbrRequest;
  audioFormatId: FormatId;
  videoFormatId: FormatId;
  signal: AbortSignal;
  log: (msg: string) => void;
}): Promise<Phase1Result> {
  const audioProgress = newFormatProgress(audioFormatId);
  const videoProgress = newFormatProgress(videoFormatId);
  let cookie: Uint8Array | undefined;
  let requestNumber = 1;
  let hadAttestationBlock = false;

  for (let attempt = 0; attempt < PHASE1_MAX_FETCHES && !signal.aborted; attempt++) {
    let body: Uint8Array;
    let url: string;
    if (attempt === 0) {
      body = templateBody;
      url = templateUrl;
    } else {
      body = buildContinuationBody({
        decodedTemplate,
        playerTimeMs: audioProgress.totalDurationMs,
        audioProgress,
        videoProgress,
        audioBufferedDurationMs: audioProgress.totalDurationMs,
        videoBufferedDurationMs: videoProgress.totalDurationMs,
        playbackCookieBytes: cookie
      });
      url = urlWithRequestNumber(templateUrl, requestNumber++);
    }

    let responseBytes: Uint8Array;
    try {
      const response = await fetchWithTimeout(url, body, signal);
      responseBytes = new Uint8Array(await response.arrayBuffer());
    } catch (err) {
      log(`phase1 attempt=${attempt} fetch threw: ${String(err)}`);
      break;
    }

    const decoded = decodeResponseBody(responseBytes);
    log(
      `phase1 attempt=${attempt} bytes=${responseBytes.byteLength} `
      + `mediaBytes=${decoded.totalMediaBytes} segments=${decoded.segments.length} `
      + `audioCadence=${audioProgress.inferredSegDurMs}ms videoCadence=${videoProgress.inferredSegDurMs}ms`
    );

    if (decoded.hasSabrError || decoded.protectionStatus === 3) {
      hadAttestationBlock = true;
      break;
    }

    if (decoded.totalMediaBytes === 0) {
      break;
    }

    if (decoded.playbackCookieBytes) {
      cookie = decoded.playbackCookieBytes;
    }

    for (const segment of decoded.segments) {
      if (segment.itag === audioProgress.itag) {
        appendSegment(audioProgress, segment);
      } else if (segment.itag === videoProgress.itag) {
        appendSegment(videoProgress, segment);
      }
    }

    if (audioProgress.totalDurationMs >= OFFSET_STEP_MS && videoProgress.totalDurationMs >= OFFSET_STEP_MS) {
      break;
    }
  }

  return {
    audioProgress,
    videoProgress,
    cookie,
    hadAttestationBlock
  };
}

export async function downloadViaSabrProgressive({
  request, signal, tabId, template
}: {
  request: DownloadRequest;
  signal: AbortSignal;
  tabId: number;
  template: ChunkedTemplate;
}): Promise<DownloadResult | null> {
  const { videoId, sabrConfig: maybeConfig, videoFormat: maybeVideo, audioFormat: maybeAudio } = request;
  if (!maybeConfig || !maybeVideo || !maybeAudio) {
    return null;
  }

  const sabrConfig: SabrConfig = maybeConfig;
  const videoFormat: AdaptiveFormatItem = maybeVideo;
  const audioFormat: AdaptiveFormatItem = maybeAudio;

  const durationMs = parseInt(audioFormat.approxDurationMs ?? "0", 10);
  if (durationMs === 0) {
    return null;
  }

  function log(msg: string) {
    console.log(`[ytdl:sabr-progressive] ${msg}`);
  }

  const templateBody = decodeBase64(template.bodyBase64);
  const decodedTemplate = VideoPlaybackAbrRequest.decode(templateBody);
  const audioFormatId = decodedTemplate.selectedFormatIds[0] ?? { itag: audioFormat.itag };
  const videoFormatId = decodedTemplate.selectedFormatIds[1] ?? { itag: videoFormat.itag };
  log(`audioItag=${audioFormatId.itag} videoItag=${videoFormatId.itag} durationMs=${durationMs}`);

  void sabrConfig;

  // Phase 1: iterate the trust-template session, harvesting audio + video
  // segment cadence so phase 2's bufferedRanges reflect real fragment lengths.
  const phase1 = await runPhase1({
    templateUrl: template.url,
    templateBody,
    decodedTemplate,
    audioFormatId,
    videoFormatId,
    signal,
    log
  });
  if (phase1.hadAttestationBlock) {
    log("phase1 attestation_required — aborting progressive");
    return null;
  }

  if (phase1.audioProgress.segmentBytes.length === 0 && phase1.videoProgress.segmentBytes.length === 0) {
    log("phase1 returned no usable segments");
    return null;
  }

  const audioCadence = phase1.audioProgress.inferredSegDurMs;
  const videoCadence = phase1.videoProgress.inferredSegDurMs;
  log(
    `phase1 done: audioParts=${phase1.audioProgress.segmentBytes.length} `
    + `videoParts=${phase1.videoProgress.segmentBytes.length} `
    + `audioMs=${phase1.audioProgress.totalDurationMs} videoMs=${phase1.videoProgress.totalDurationMs} `
    + `audioCadence=${audioCadence}ms videoCadence=${videoCadence}ms`
  );

  // Phase 2: parallel offset fetches starting after phase 1's coverage.
  const phase1AudioMs = phase1.audioProgress.totalDurationMs || OFFSET_STEP_MS;
  const offsets: number[] = [];
  for (let timeMs = phase1AudioMs; timeMs < durationMs; timeMs += OFFSET_STEP_MS) {
    offsets.push(timeMs);
  }
  log(`phase2 offsets=${offsets.length}`);

  const totalSegments = offsets.length + 1;
  let completed = 1;
  void sendProgressUpdate({
    videoId,
    progress: completed / totalSegments,
    progressType: ProgressType.Video,
    tabId
  });

  const results: Array<{
    audioBytes: Uint8Array[];
    videoBytes: Uint8Array[];
  } | null>
    = new Array(offsets.length).fill(null);
  let cursor = 0;
  let requestNumberCounter = PHASE1_MAX_FETCHES + 1;

  async function worker() {
    while (cursor < offsets.length && !signal.aborted) {
      const idx = cursor++;
      const fromMs = offsets[idx];
      const seed = requestNumberCounter;
      requestNumberCounter += MAX_FETCHES_PER_OFFSET;
      try {
        results[idx] = await fetchOffsetWindow({
          decodedTemplate,
          baseUrl: template.url,
          fromMs,
          requestNumberSeed: seed,
          audioFormatId,
          videoFormatId,
          startCookie: phase1.cookie,
          audioCadenceMs: audioCadence,
          videoCadenceMs: videoCadence,
          signal,
          log
        });
      } catch (err) {
        log(`offset ${fromMs} threw: ${String(err)}`);
      }
      completed++;
      void sendProgressUpdate({
        videoId,
        progress: Math.min(completed / totalSegments, 1),
        progressType: ProgressType.Video,
        tabId
      });
    }
  }

  await Promise.all(Array.from({ length: Math.min(MAX_PARALLEL, offsets.length || 1) }, () => worker()));

  const audioParts = [...phase1.audioProgress.segmentBytes];
  const videoParts = [...phase1.videoProgress.segmentBytes];
  for (const offsetResult of results) {
    if (!offsetResult) {
      continue;
    }

    audioParts.push(...offsetResult.audioBytes);
    videoParts.push(...offsetResult.videoBytes);
  }

  const audioData = concat(audioParts);
  const videoData = concat(videoParts);

  log(`done: video=${videoData.byteLength}B audio=${audioData.byteLength}B`);

  if (audioData.byteLength === 0 && videoData.byteLength === 0) {
    return null;
  }

  return {
    videoData,
    audioData,
    additionalAudioTracks: []
  };
}
