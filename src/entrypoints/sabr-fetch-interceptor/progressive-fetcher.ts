import { buildSyntheticTemplateFromPlayer, waitForTemplate } from "./template-builder";
import type { FormatProgress, ProgressiveCarryState, ProgressiveFetchResult, ProgressiveState } from "./types";
import {
  ClientAbrState,
  MediaHeader,
  NextRequestPolicy,
  PlaybackCookie,
  StreamerContext,
  UMPPartId,
  VideoPlaybackAbrRequest
} from "googlevideo/protos";
import { CompositeBuffer, UmpReader } from "googlevideo/ump";

const STALL_LIMIT = 3;
const STALL_REWIND_MS = 5_000;

function buildRequestBody({ templateBody, playerTimeMs, audio, video, playbackCookieBytes }: {
  templateBody: Uint8Array;
  playerTimeMs: number;
  audio: FormatProgress;
  video: FormatProgress;
  playbackCookieBytes: Uint8Array | null;
}): Uint8Array {
  const decoded = VideoPlaybackAbrRequest.decode(templateBody);
  decoded.playerTimeMs = String(playerTimeMs);

  if (!decoded.clientAbrState) {
    decoded.clientAbrState = ClientAbrState.decode(new Uint8Array());
  }

  decoded.clientAbrState.playerTimeMs = String(playerTimeMs);
  decoded.bufferedRanges = [];

  for (const formatId of decoded.selectedFormatIds) {
    let target: FormatProgress | null = null;
    if (formatId.itag === audio.itag) {
      target = audio;
    } else if (formatId.itag === video.itag) {
      target = video;
    }

    if (target && target.endMs > 0) {
      decoded.bufferedRanges.push({
        formatId,
        startTimeMs: "0",
        durationMs: String(target.endMs),
        startSegmentIndex: 1,
        endSegmentIndex: target.lastSeq
      });
    }
  }

  if (playbackCookieBytes) {
    if (!decoded.streamerContext) {
      decoded.streamerContext = StreamerContext.decode(new Uint8Array());
    }

    decoded.streamerContext.playbackCookie = playbackCookieBytes;
  }

  return VideoPlaybackAbrRequest.encode(decoded).finish();
}

async function performFetch({ url, body, originalFetch }: {
  url: string;
  body: Uint8Array;
  originalFetch: typeof globalThis.fetch;
}): Promise<Uint8Array> {
  const fresh = new Uint8Array(body.byteLength);
  fresh.set(body);
  const response = await originalFetch(url, {
    method: "POST",
    body: fresh,
    mode: "cors",
    credentials: "include"
  });
  if (!response.ok) {
    throw new Error(`SABR fetch returned status ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return new Uint8Array(arrayBuffer);
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

function ingestUmpResponse({ response, audio, video, audioItag, videoItag }: {
  response: Uint8Array;
  audio: FormatProgress;
  video: FormatProgress;
  audioItag: number;
  videoItag: number;
}) {
  const reader = new UmpReader(new CompositeBuffer([response]));
  let pendingItag = -1;
  let nextRequestPolicyBytes: Uint8Array | null = null;
  reader.read((part: {
    type: number;
    size: number;
    data: CompositeBuffer;
  }) => {
    const partBytes = compositeBufferToUint8(part.data);
    if (part.type === UMPPartId.MEDIA_HEADER) {
      const header = MediaHeader.decode(partBytes);
      const itag = header.itag ?? -1;
      pendingItag = itag;
      const startMs = parseInt(header.startMs ?? "0", 10);
      const durMs = parseInt(header.durationMs ?? "0", 10);
      const endMs = startMs + durMs;
      let target: FormatProgress | null = null;
      if (itag === audioItag) {
        target = audio;
      } else if (itag === videoItag) {
        target = video;
      }

      if (target) {
        if (endMs > target.endMs) {
          target.endMs = endMs;
        }

        if ((header.sequenceNumber ?? 0) > target.lastSeq) {
          target.lastSeq = header.sequenceNumber ?? target.lastSeq;
        }
      }
    } else if (part.type === UMPPartId.MEDIA) {
      const payload = partBytes.subarray(1);
      let target: FormatProgress | null = null;
      if (pendingItag === audioItag) {
        target = audio;
      } else if (pendingItag === videoItag) {
        target = video;
      }

      if (target) {
        const seq = target.lastSeq;
        const existing = target.segmentBytes.get(seq);
        if (existing) {
          const merged = new Uint8Array(existing.byteLength + payload.byteLength);
          merged.set(existing, 0);
          merged.set(payload, existing.byteLength);
          target.segmentBytes.set(seq, merged);
        } else {
          target.segmentBytes.set(seq, payload);
        }
      }
    } else if (part.type === UMPPartId.NEXT_REQUEST_POLICY) {
      nextRequestPolicyBytes = partBytes;
    }
  });
  return nextRequestPolicyBytes;
}

function buildContiguousBytes(format: FormatProgress): Uint8Array {
  const sortedSeqs = [...format.segmentBytes.keys()].sort((seqA, seqB) => seqA - seqB);
  const total = sortedSeqs.reduce(
    (sum, seq) => sum + (format.segmentBytes.get(seq)?.byteLength ?? 0),
    0
  );
  const out = new Uint8Array(total);
  let offset = 0;
  for (const seq of sortedSeqs) {
    const bytes = format.segmentBytes.get(seq);
    if (bytes) {
      out.set(bytes, offset);
      offset += bytes.byteLength;
    }
  }
  return out;
}

function buildResult({ state, audioItag, videoItag, iterations, stalled }: {
  state: ProgressiveState;
  audioItag: number;
  videoItag: number;
  iterations: number;
  stalled: boolean;
}): ProgressiveFetchResult {
  return {
    audioBytes: buildContiguousBytes(state.audio),
    videoBytes: buildContiguousBytes(state.video),
    audioCoveredMs: state.audio.endMs,
    videoCoveredMs: state.video.endMs,
    audioItag,
    videoItag,
    iterations,
    stalled,
    carryState: {
      audioEndMs: state.audio.endMs,
      audioLastSeq: state.audio.lastSeq,
      videoEndMs: state.video.endMs,
      videoLastSeq: state.video.lastSeq,
      audioSegmentBytes: state.audio.segmentBytes,
      videoSegmentBytes: state.video.segmentBytes,
      playbackCookieBytes: state.playbackCookieBytes
    }
  };
}

export async function fetchProgressive({ targetDurationMs, maxIterations, originalFetch, carryState }: {
  targetDurationMs: number;
  maxIterations: number;
  originalFetch: typeof globalThis.fetch;
  carryState: ProgressiveCarryState | null;
}): Promise<ProgressiveFetchResult> {
  const template = await waitForTemplate({ timeoutMs: 30_000 });
  const initial = VideoPlaybackAbrRequest.decode(template.body);
  if (initial.selectedFormatIds.length < 2) {
    throw new Error(`SABR template needs audio + video formats; got ${initial.selectedFormatIds.length}`);
  }

  const audioItag = initial.selectedFormatIds[0]?.itag ?? -1;
  const videoItag = initial.selectedFormatIds[1]?.itag ?? -1;

  const state: ProgressiveState = {
    audio: {
      itag: audioItag,
      endMs: carryState?.audioEndMs ?? 0,
      lastSeq: carryState?.audioLastSeq ?? 0,
      segmentBytes: new Map(carryState?.audioSegmentBytes ?? [])
    },
    video: {
      itag: videoItag,
      endMs: carryState?.videoEndMs ?? 0,
      lastSeq: carryState?.videoLastSeq ?? 0,
      segmentBytes: new Map(carryState?.videoSegmentBytes ?? [])
    },
    playbackCookieBytes: carryState?.playbackCookieBytes ?? null
  };

  let playerTimeMs = Math.min(state.audio.endMs, state.video.endMs);
  let stallStreak = 0;
  let iteration = 0;
  let activeTemplateBody = template.body;
  let activeTemplateUrl = template.url;

  for (; iteration < maxIterations; iteration++) {
    const requestBody = buildRequestBody({
      templateBody: activeTemplateBody,
      playerTimeMs,
      audio: state.audio,
      video: state.video,
      playbackCookieBytes: state.playbackCookieBytes
    });
    const response = await performFetch({
      url: activeTemplateUrl,
      body: requestBody,
      originalFetch
    });

    const beforeAudioEnd = state.audio.endMs;
    const beforeVideoEnd = state.video.endMs;
    const nextRequestPolicyBytes = ingestUmpResponse({
      response,
      audio: state.audio,
      video: state.video,
      audioItag,
      videoItag
    });
    if (nextRequestPolicyBytes) {
      try {
        const policy = NextRequestPolicy.decode(nextRequestPolicyBytes);
        if (policy.playbackCookie) {
          const encodedCookie = PlaybackCookie.encode(policy.playbackCookie).finish();
          state.playbackCookieBytes = encodedCookie;
        }
      } catch (_) {
        // ignore decode error; keep using prior cookie
      }
    }

    const isAudioAdvanced = state.audio.endMs > beforeAudioEnd;
    const isVideoAdvanced = state.video.endMs > beforeVideoEnd;
    const isAdvanced = isAudioAdvanced || isVideoAdvanced;
    if (!isAdvanced) {
      stallStreak++;
      const refreshed = buildSyntheticTemplateFromPlayer();
      if (refreshed) {
        activeTemplateBody = refreshed.body;
        activeTemplateUrl = refreshed.url;
        window.__ytdlSabrTemplate = refreshed;
      }

      if (stallStreak >= STALL_LIMIT) {
        return buildResult({
          state,
          audioItag,
          videoItag,
          iterations: iteration + 1,
          stalled: true
        });
      }

      playerTimeMs = Math.max(0, playerTimeMs - STALL_REWIND_MS);
      continue;
    }

    stallStreak = 0;

    const isBothTracksComplete = state.audio.endMs >= targetDurationMs && state.video.endMs >= targetDurationMs;
    if (isBothTracksComplete) {
      break;
    }

    playerTimeMs = Math.min(state.audio.endMs, state.video.endMs);
  }

  return buildResult({
    state,
    audioItag,
    videoItag,
    iterations: iteration + 1,
    stalled: false
  });
}
