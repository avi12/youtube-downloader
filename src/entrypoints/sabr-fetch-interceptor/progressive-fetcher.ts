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
}) {
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

  // Always manage the playback cookie explicitly. The captured template body
  // may contain the player's own session cookie (for a different playback
  // position); including it would cause the server to reject requests that
  // claim a different position than the cookie implies.
  if (!decoded.streamerContext) {
    decoded.streamerContext = StreamerContext.decode(new Uint8Array());
  }

  decoded.streamerContext.playbackCookie = playbackCookieBytes ?? undefined;

  return VideoPlaybackAbrRequest.encode(decoded).finish();
}

async function performFetch({ url, body, originalFetch }: {
  url: string;
  body: Uint8Array;
  originalFetch: typeof globalThis.fetch;
}) {
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

function compositeBufferToUint8(buffer: CompositeBuffer) {
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
  // SABR interleaves MEDIA_HEADERs for audio and video before sending MEDIA
  // parts. Using pendingItag (the last seen MEDIA_HEADER's itag) to route MEDIA
  // parts is wrong when two headers arrive before any data - the second header
  // overwrites pendingItag, misrouting all data from the first header.
  // Use MediaHeader.headerId (embedded as the first byte of each MEDIA part) to
  // correctly match each data chunk to its own header regardless of order.
  type HeaderEntry = {
    target: FormatProgress;
    seq: number;
  };
  const headerMap = new Map<number, HeaderEntry>();
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
      const startMs = parseInt(header.startMs ?? "0", 10);
      const durMs = parseInt(header.durationMs ?? "0", 10);
      const endMs = startMs + durMs;
      const seq = header.sequenceNumber ?? 0;
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

        if (seq > target.lastSeq) {
          target.lastSeq = seq;
        }

        headerMap.set(header.headerId ?? 0, {
          target,
          seq
        });
      }
    } else if (part.type === UMPPartId.MEDIA) {
      const headerId = partBytes[0] ?? 0;
      const payload = partBytes.subarray(1);
      const entry = headerMap.get(headerId);
      if (entry) {
        const { target, seq } = entry;
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

function buildContiguousBytes(format: FormatProgress) {
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

function buildResult({ state, audioItag, videoItag, iterations, isStalled }: {
  state: ProgressiveState;
  audioItag: number;
  videoItag: number;
  iterations: number;
  isStalled: boolean;
}) {
  return {
    audioBytes: buildContiguousBytes(state.audio),
    videoBytes: buildContiguousBytes(state.video),
    audioCoveredMs: state.audio.endMs,
    videoCoveredMs: state.video.endMs,
    audioItag,
    videoItag,
    iterations,
    isStalled,
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

function updatePlaybackCookie(state: ProgressiveState, nextRequestPolicyBytes: Uint8Array | null) {
  if (!nextRequestPolicyBytes) {
    return;
  }

  try {
    const policy = NextRequestPolicy.decode(nextRequestPolicyBytes);
    if (policy.playbackCookie) {
      state.playbackCookieBytes = PlaybackCookie.encode(policy.playbackCookie).finish();
    }
  } catch (_) {
    // keep using prior cookie
  }
}

type IterationContext = {
  state: ProgressiveState;
  activeTemplateBody: Uint8Array;
  activeTemplateUrl: string;
  playerTimeMs: number;
  audioItag: number;
  videoItag: number;
  originalFetch: typeof globalThis.fetch;
};

const IterationResultKind = {
  StallExit: "stall-exit",
  Complete: "complete",
  Advance: "advance",
  StallRetry: "stall-retry"
} as const;
type IterationResultKind = (typeof IterationResultKind)[keyof typeof IterationResultKind];

type IterationResult =
  | {
    kind: typeof IterationResultKind.StallExit;
    result: ProgressiveFetchResult;
  }
  | { kind: typeof IterationResultKind.Complete }
  | {
    kind: typeof IterationResultKind.Advance;
    nextPlayerTimeMs: number;
  }
  | {
    kind: typeof IterationResultKind.StallRetry;
    nextPlayerTimeMs: number;
    templateBody: Uint8Array;
    templateUrl: string;
  };

async function runFetchIteration(
  ctx: IterationContext,
  stallStreak: number,
  targetDurationMs: number,
  iteration: number
): Promise<IterationResult> {
  const { state, activeTemplateBody, activeTemplateUrl, playerTimeMs, audioItag, videoItag, originalFetch } = ctx;

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
  updatePlaybackCookie(state, nextRequestPolicyBytes);

  const isAdvanced = state.audio.endMs > beforeAudioEnd || state.video.endMs > beforeVideoEnd;
  if (!isAdvanced) {
    const refreshed = buildSyntheticTemplateFromPlayer();
    if (refreshed) {
      window.__ytdlSabrTemplate = refreshed;
    }

    if (stallStreak + 1 >= STALL_LIMIT) {
      return {
        kind: IterationResultKind.StallExit,
        result: buildResult({
          state,
          audioItag,
          videoItag,
          iterations: iteration + 1,
          isStalled: true
        })
      };
    }

    return {
      kind: IterationResultKind.StallRetry,
      nextPlayerTimeMs: Math.max(0, playerTimeMs - STALL_REWIND_MS),
      templateBody: refreshed?.body ?? activeTemplateBody,
      templateUrl: refreshed?.url ?? activeTemplateUrl
    };
  }

  if (state.audio.endMs >= targetDurationMs && state.video.endMs >= targetDurationMs) {
    return { kind: IterationResultKind.Complete };
  }

  return {
    kind: IterationResultKind.Advance,
    nextPlayerTimeMs: Math.min(state.audio.endMs, state.video.endMs)
  };
}

export async function fetchProgressive({
  targetDurationMs,
  maxIterations,
  originalFetch,
  carryState,
  initialPlayerTimeMs
}: {
  targetDurationMs: number;
  maxIterations: number;
  originalFetch: typeof globalThis.fetch;
  carryState: ProgressiveCarryState | null;
  initialPlayerTimeMs?: number;
}) {
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

  let playerTimeMs = initialPlayerTimeMs ?? Math.min(state.audio.endMs, state.video.endMs);
  let stallStreak = 0;
  let activeTemplateBody = template.body;
  let activeTemplateUrl = template.url;
  let iteration = 0;

  for (; iteration < maxIterations; iteration++) {
    const iterResult = await runFetchIteration(
      {
        state,
        activeTemplateBody,
        activeTemplateUrl,
        playerTimeMs,
        audioItag,
        videoItag,
        originalFetch
      },
      stallStreak,
      targetDurationMs,
      iteration
    );
    if (iterResult.kind === IterationResultKind.StallExit) {
      return iterResult.result;
    }

    if (iterResult.kind === IterationResultKind.Complete) {
      break;
    }

    if (iterResult.kind === IterationResultKind.StallRetry) {
      stallStreak++;
      playerTimeMs = iterResult.nextPlayerTimeMs;
      activeTemplateBody = iterResult.templateBody;
      activeTemplateUrl = iterResult.templateUrl;
      continue;
    }

    stallStreak = 0;
    playerTimeMs = iterResult.nextPlayerTimeMs;
  }

  return buildResult({
    state,
    audioItag,
    videoItag,
    iterations: iteration + 1,
    isStalled: false
  });
}
