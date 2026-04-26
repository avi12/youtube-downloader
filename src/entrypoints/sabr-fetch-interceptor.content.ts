// Captures the player's outgoing googlevideo SABR POST Requests at
// document_start so we have a "trust template" — the protobuf body the player
// has already signed (PoToken + session signals). Replaying with no
// Content-Type header is a CORS simple-request, server returns ACAO and the
// response is readable. Threading playerTimeMs / bufferedRanges /
// playbackCookie progressively fetches successive media chunks via the SABR
// API, bypassing the iframe-scrub mechanism for short videos.
//
// Server-side limit: ~60s of media per single template (player must keep
// emitting fresh SABR calls to extend the trust window). For >60s videos,
// fall back to iframe-scrub.

import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";
import { uint8ToBase64 } from "@/lib/utils/binary";
import type { YtdlSabrTemplate } from "@/types";
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

const GOOGLEVIDEO_HOST_FRAGMENT = "googlevideo.com/videoplayback";
const POLL_INTERVAL_MS = 100;
const AD_SHOWING_SELECTOR = ".html5-video-player.ad-showing";

interface ProgressiveCarryState {
  audioEndMs: number;
  audioLastSeq: number;
  videoEndMs: number;
  videoLastSeq: number;
  audioSegmentBytes: Map<number, Uint8Array>;
  videoSegmentBytes: Map<number, Uint8Array>;
  playbackCookieBytes: Uint8Array | null;
}

interface ProgressiveFetchResult {
  audioBytes: Uint8Array;
  videoBytes: Uint8Array;
  audioCoveredMs: number;
  videoCoveredMs: number;
  audioItag: number;
  videoItag: number;
  iterations: number;
  stalled: boolean;
  carryState: ProgressiveCarryState;
}

declare global {
  interface Window {
    __ytdlSabrTemplate?: YtdlSabrTemplate;
    __ytdlSabr?: {
      hasTemplate: () => boolean;
      fetchProgressive: (options: {
        targetDurationMs: number;
        maxIterations?: number;
        carryState?: ProgressiveCarryState | null;
      }) => Promise<ProgressiveFetchResult>;
    };
  }
}

interface FormatProgress {
  itag: number;
  endMs: number;
  lastSeq: number;
  segmentBytes: Map<number, Uint8Array>;
}

interface ProgressiveState {
  audio: FormatProgress;
  video: FormatProgress;
  playbackCookieBytes: Uint8Array | null;
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
      // First byte is a varint headerId; rest is the media payload.
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
  // No Content-Type header — that's the CORS simple-request bypass.
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

async function waitForTemplate({ timeoutMs }: {
  timeoutMs: number;
}): Promise<YtdlSabrTemplate> {
  const deadlineAt = Date.now() + timeoutMs;
  while (Date.now() < deadlineAt) {
    const template = window.__ytdlSabrTemplate;
    if (template) {
      return template;
    }

    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error("no SABR template captured within timeout");
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

async function fetchProgressive({ targetDurationMs, maxIterations, originalFetch, carryState }: {
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

  for (; iteration < maxIterations; iteration++) {
    const requestBody = buildRequestBody({
      templateBody: template.body,
      playerTimeMs,
      audio: state.audio,
      video: state.video,
      playbackCookieBytes: state.playbackCookieBytes
    });

    const response = await performFetch({
      url: template.url,
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
          state.playbackCookieBytes = PlaybackCookie.encode(policy.playbackCookie).finish();
        }
      } catch (_) {
        // ignore decode error; keep using prior cookie
      }
    }

    const advanced = state.audio.endMs > beforeAudioEnd || state.video.endMs > beforeVideoEnd;
    if (!advanced) {
      stallStreak++;

      if (stallStreak >= 2) {
        return buildResult({
          state,
          audioItag,
          videoItag,
          iterations: iteration + 1,
          stalled: true
        });
      }

      playerTimeMs = Math.max(0, playerTimeMs - 5_000);
      continue;
    }

    stallStreak = 0;

    if (state.audio.endMs >= targetDurationMs && state.video.endMs >= targetDurationMs) {
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

export default defineContentScript({
  matches: ["https://www.youtube.com/*"],
  world: "MAIN",
  runAt: "document_start",
  allFrames: true,
  main() {
    const originalFetch = globalThis.fetch.bind(globalThis);
    // Factory iframes spawned by sabr-progressive only need a fresh trust
    // template; we can't wait for ad-clear there because the iframe's player
    // doesn't autoplay reliably. Skip the ad filter so the very first SABR
    // call in those iframes is captured regardless of ad state.
    const isFactoryFrame = location.search.includes("ytdlTrustFactoryMode=1");

    globalThis.fetch = async function patchedFetch(input: RequestInfo | URL, init?: RequestInit) {
      const url = input instanceof Request ? input.url : String(input);
      const method = input instanceof Request ? input.method : init?.method;
      if (method === "POST" && url.includes(GOOGLEVIDEO_HOST_FRAGMENT)) {
        const isAdShowing = !isFactoryFrame && Boolean(document.querySelector(AD_SHOWING_SELECTOR));
        if (!isAdShowing) {
          try {
            const reqClone = input instanceof Request ? input.clone() : new Request(input, init);
            const bodyBuffer = await reqClone.clone().arrayBuffer();
            const bodyBytes = new Uint8Array(bodyBuffer);
            const decoded = VideoPlaybackAbrRequest.decode(bodyBytes);
            if (decoded.selectedFormatIds.length > 0) {
              const capturedAt = Date.now();
              window.__ytdlSabrTemplate = {
                url,
                body: bodyBytes,
                capturedAt
              };
              void crossWorldMessenger.sendMessage(CrossWorldMessage.SabrTemplateCaptured, {
                url,
                bodyBase64: uint8ToBase64(bodyBytes),
                capturedAt
              });
            }
          } catch (_) {
            // best-effort capture; never break the player
          }
        }
      }

      return originalFetch(input, init);
    };

    crossWorldMessenger.onMessage(CrossWorldMessage.PullSabrTemplate, () => {
      const template = window.__ytdlSabrTemplate;
      if (!template) {
        return null;
      }

      return {
        url: template.url,
        bodyBase64: uint8ToBase64(template.body),
        capturedAt: template.capturedAt
      };
    });

    window.__ytdlSabr = {
      hasTemplate: () => Boolean(window.__ytdlSabrTemplate),
      fetchProgressive: ({ targetDurationMs, maxIterations = 80, carryState = null }) => fetchProgressive({
        targetDurationMs,
        maxIterations,
        originalFetch,
        carryState
      })
    };
  }
});
