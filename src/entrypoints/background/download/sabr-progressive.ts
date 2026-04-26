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
      bytes: merged
    });
  }

  return result;
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

function buildOffsetBody({
  decodedTemplate, fromMs, audioBufferedDurationMs, videoBufferedDurationMs,
  audioFormatId, videoFormatId, playbackCookieBytes
}: {
  decodedTemplate: VideoPlaybackAbrRequest;
  fromMs: number;
  audioBufferedDurationMs: number;
  videoBufferedDurationMs: number;
  audioFormatId: FormatId;
  videoFormatId: FormatId;
  playbackCookieBytes?: Uint8Array;
}): Uint8Array {
  const next: VideoPlaybackAbrRequest = {
    ...decodedTemplate,
    clientAbrState: {
      ...(decodedTemplate.clientAbrState ?? {}),
      playerTimeMs: String(fromMs)
    },
    bufferedRanges: [
      {
        formatId: audioFormatId,
        startTimeMs: "0",
        durationMs: String(audioBufferedDurationMs),
        startSegmentIndex: 1,
        endSegmentIndex: Math.max(1, Math.floor(audioBufferedDurationMs / 5_000))
      },
      {
        formatId: videoFormatId,
        startTimeMs: "0",
        durationMs: String(videoBufferedDurationMs),
        startSegmentIndex: 1,
        endSegmentIndex: Math.max(1, Math.floor(videoBufferedDurationMs / 5_000))
      }
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

interface OffsetState {
  fromMs: number;
  audioItag: number;
  videoItag: number;
  audioBytes: Uint8Array[];
  videoBytes: Uint8Array[];
  audioDurationMs: number;
  videoDurationMs: number;
}

async function fetchOffsetWindow({
  decodedTemplate, baseUrl, fromMs, requestNumberSeed, audioFormatId, videoFormatId,
  startCookie, signal, log
}: {
  decodedTemplate: VideoPlaybackAbrRequest;
  baseUrl: string;
  fromMs: number;
  requestNumberSeed: number;
  audioFormatId: FormatId;
  videoFormatId: FormatId;
  startCookie?: Uint8Array;
  signal: AbortSignal;
  log: (msg: string) => void;
}): Promise<OffsetState> {
  const state: OffsetState = {
    fromMs,
    audioItag: audioFormatId.itag ?? 0,
    videoItag: videoFormatId.itag ?? 0,
    audioBytes: [],
    videoBytes: [],
    audioDurationMs: 0,
    videoDurationMs: 0
  };
  let cookie = startCookie;
  let requestNumber = requestNumberSeed;

  for (let attempt = 0; attempt < MAX_FETCHES_PER_OFFSET && !signal.aborted; attempt++) {
    const body = buildOffsetBody({
      decodedTemplate,
      fromMs: fromMs + state.audioDurationMs,
      audioBufferedDurationMs: fromMs + state.audioDurationMs,
      videoBufferedDurationMs: fromMs + state.videoDurationMs,
      audioFormatId,
      videoFormatId,
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
    log(`fromMs=${fromMs} attempt=${attempt} bytes=${responseBytes.byteLength} mediaBytes=${decoded.totalMediaBytes} segments=${decoded.segments.length}`);

    if (decoded.hasSabrError || decoded.protectionStatus === 3) {
      break;
    }

    if (decoded.totalMediaBytes === 0) {
      break;
    }

    if (decoded.playbackCookieBytes) {
      cookie = decoded.playbackCookieBytes;
    }

    const priorAudio = state.audioDurationMs;
    const priorVideo = state.videoDurationMs;
    for (const segment of decoded.segments) {
      if (segment.itag === state.audioItag) {
        state.audioBytes.push(segment.bytes);
      } else if (segment.itag === state.videoItag) {
        state.videoBytes.push(segment.bytes);
      }
    }

    // Approximate per-segment duration: response covers ~ totalMediaBytes / bitrate seconds.
    // Use a conservative 5s/segment increment (server's typical fragment cadence).
    state.audioDurationMs += 5_000;
    state.videoDurationMs += 5_000;

    if (state.audioDurationMs - priorAudio === 0 && state.videoDurationMs - priorVideo === 0) {
      break;
    }

    if (state.audioDurationMs >= OFFSET_STEP_MS && state.videoDurationMs >= OFFSET_STEP_MS) {
      break;
    }
  }

  return state;
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

async function fetchPhase1({
  templateUrl, templateBody, signal, log
}: {
  templateUrl: string;
  templateBody: Uint8Array;
  signal: AbortSignal;
  log: (msg: string) => void;
}) {
  const response = await fetchWithTimeout(templateUrl, templateBody, signal);
  const responseBytes = new Uint8Array(await response.arrayBuffer());
  const decoded = decodeResponseBody(responseBytes);
  log(`phase1 bytes=${responseBytes.byteLength} mediaBytes=${decoded.totalMediaBytes} segments=${decoded.segments.length}`);
  return {
    decoded,
    responseBytes
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

  // Phase 1: replay captured body verbatim, decode response.
  let phase1Result;
  try {
    phase1Result = await fetchPhase1({
      templateUrl: template.url,
      templateBody,
      signal,
      log
    });
  } catch (err) {
    log(`phase1 fetch threw: ${String(err)}`);
    return null;
  }

  if (phase1Result.decoded.hasSabrError || phase1Result.decoded.protectionStatus === 3) {
    log("phase1 attestation_required or sabr_error — aborting progressive");
    return null;
  }

  const audioPhase1: Uint8Array[] = [];
  const videoPhase1: Uint8Array[] = [];
  for (const segment of phase1Result.decoded.segments) {
    if (segment.itag === audioFormatId.itag) {
      audioPhase1.push(segment.bytes);
    } else if (segment.itag === videoFormatId.itag) {
      videoPhase1.push(segment.bytes);
    }
  }

  if (audioPhase1.length === 0 && videoPhase1.length === 0) {
    log("phase1 returned no usable segments");
    return null;
  }

  void sabrConfig;
  const cookie = phase1Result.decoded.playbackCookieBytes;
  log(`phase1 audioParts=${audioPhase1.length} videoParts=${videoPhase1.length} cookie=${cookie ? "present" : "missing"}`);

  // Phase 2: parallel offset fetches for the rest of the video.
  const offsets: number[] = [];
  for (let timeMs = OFFSET_STEP_MS; timeMs < durationMs; timeMs += OFFSET_STEP_MS) {
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

  const results: Array<OffsetState | null> = new Array(offsets.length).fill(null);
  let cursor = 0;
  let requestNumberCounter = 1;

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
          startCookie: cookie,
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

  // Concat all parts in offset order.
  const audioParts = [...audioPhase1];
  const videoParts = [...videoPhase1];
  for (const offsetState of results) {
    if (!offsetState) {
      continue;
    }

    audioParts.push(...offsetState.audioBytes);
    videoParts.push(...offsetState.videoBytes);
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
