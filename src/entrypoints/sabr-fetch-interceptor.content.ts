// Captures the player's outgoing googlevideo SABR POST Requests at
// document_start so we have a "trust template" - the protobuf body the player
// has already signed (PoToken + session signals). Replaying with no
// Content-Type header is a CORS simple-request, server returns ACAO and the
// response is readable. Threading playerTimeMs / bufferedRanges /
// playbackCookie progressively fetches successive media chunks via the SABR
// API, bypassing the iframe-scrub mechanism for short videos.
//
// Server-side limit: ~60s of media per single template (player must keep
// emitting fresh SABR calls to extend the trust window). For >60s videos,
// fall back to iframe-scrub.

import {
  CrossWorldMessage,
  CrossWorldSabrMessage,
  crossWorldMessenger,
  crossWorldSabrMessenger
} from "@/lib/messaging/cross-world-messenger";
import { base64ToUint8Array, uint8ToBase64 } from "@/lib/utils/binary";
import { AD_SHOWING_SELECTOR, MOVIE_PLAYER_SELECTOR } from "@/lib/youtube/player-selectors";
import type { AdaptiveFormatItem, PlayerResponse, YtdlSabrTemplate } from "@/types";
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

interface MoviePlayerElement extends HTMLElement {
  getPlayerResponse?: () => PlayerResponse;
}

interface YtcfgInnertubeClient {
  clientName?: string;
  clientVersion?: string;
  visitorData?: string;
}

interface YtcfgRoot {
  data_?: {
    INNERTUBE_CONTEXT?: {
      client?: YtcfgInnertubeClient;
    };
  };
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
      synthesize: () => YtdlSabrTemplate | null;
    };
    ytcfg?: YtcfgRoot;
    ytInitialPlayerResponse?: PlayerResponse;
    __ytdlCapturedPoToken?: string;
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

const VISIBILITY_FOREGROUND = 1;
const DEFAULT_PLAYBACK_RATE = 1;
const DEFAULT_CLIENT_NAME = 1;
const POTOKEN_QUERY_PARAM = "pot";

// YouTube serves base64-URL-encoded ustreamer config; the standard base64
// helper expects + / padding so we normalise here before decoding.
function base64UrlToUint8Array(value: string) {
  const standard = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = (4 - standard.length % 4) % 4;
  return base64ToUint8Array(standard + "=".repeat(padding));
}

function getMoviePlayer() {
  return document.querySelector<MoviePlayerElement>(MOVIE_PLAYER_SELECTOR);
}

function pickHighestQualityFormats(adaptiveFormats: AdaptiveFormatItem[]) {
  const audioFormats = adaptiveFormats.filter(format => format.mimeType?.startsWith("audio/"));
  const videoFormats = adaptiveFormats.filter(format => format.mimeType?.startsWith("video/"));
  const primaryAudio = audioFormats.find(format => format.audioTrack?.audioIsDefault) ?? audioFormats[0] ?? null;
  const sortedAudio = primaryAudio
    ? audioFormats
      .filter(format => format.audioTrack?.id === primaryAudio.audioTrack?.id || !format.audioTrack)
      .sort((left, right) => (right.bitrate ?? 0) - (left.bitrate ?? 0))[0]
    : null;
  const sortedVideo = videoFormats
    .sort((left, right) => {
      const heightDelta = (right.height ?? 0) - (left.height ?? 0);
      return heightDelta !== 0 ? heightDelta : (right.bitrate ?? 0) - (left.bitrate ?? 0);
    })[0] ?? null;
  return {
    audio: sortedAudio,
    video: sortedVideo
  };
}

function readField(record: unknown, key: string): unknown {
  if (!record || typeof record !== "object") {
    return undefined;
  }

  const entry = Object.entries(record).find(([entryKey]) => entryKey === key);
  return entry ? entry[1] : undefined;
}

function getStringField(record: unknown, key: string) {
  const value = readField(record, key);
  return typeof value === "string" ? value : "";
}

function getNumericField(record: unknown, key: string) {
  const value = readField(record, key);
  return typeof value === "number" ? value : null;
}

function readUstreamerConfig(playerResponse: PlayerResponse) {
  const playerConfigPath = playerResponse.playerConfig?.mediaCommonConfig
    ?.mediaUstreamerRequestConfig?.videoPlaybackUstreamerConfig;
  if (typeof playerConfigPath === "string" && playerConfigPath.length > 0) {
    return playerConfigPath;
  }

  const streamingDataPath = getStringField(playerResponse.streamingData, "videoPlaybackUstreamerConfig");
  if (streamingDataPath.length > 0) {
    return streamingDataPath;
  }

  return null;
}

function readClientInfo() {
  const ytcfgData = window.ytcfg?.data_;
  const ictx = ytcfgData?.INNERTUBE_CONTEXT?.client ?? {};
  const numericClientName = getNumericField(ytcfgData, "INNERTUBE_CONTEXT_CLIENT_NAME");
  return {
    clientName: numericClientName ?? DEFAULT_CLIENT_NAME,
    clientVersion: ictx.clientVersion ?? ""
  };
}

function readPoTokenFromAdaptiveFormatUrl(formats: AdaptiveFormatItem[] | undefined) {
  if (!formats) {
    return "";
  }

  for (const format of formats) {
    const url = format.url;
    if (!url) {
      continue;
    }

    try {
      const params = new URL(url).searchParams;
      const pot = params.get(POTOKEN_QUERY_PARAM);
      if (pot) {
        return pot;
      }
    } catch {
      // ignore malformed URL
    }
  }

  return "";
}

function readPoTokenFromCapturedTemplate(): Uint8Array | null {
  // If the user tab has already fired a real SABR call, the captured trust
  // template body holds a player-signed poToken. Reuse it across synthesized
  // templates for the same session — no need to mint our own.
  const template = window.__ytdlSabrTemplate;
  if (!template) {
    return null;
  }

  try {
    const decoded = VideoPlaybackAbrRequest.decode(template.body);
    const poTokenBytes = decoded.streamerContext?.poToken;
    if (poTokenBytes && poTokenBytes.length > 0) {
      return poTokenBytes;
    }
  } catch {
    // template was malformed somehow — fall through
  }

  return null;
}

function findPoToken(playerResponse: PlayerResponse) {
  const stashed = window.__ytdlCapturedPoToken;
  if (typeof stashed === "string" && stashed.length > 0) {
    return stashed;
  }

  const fromCurrent = readPoTokenFromAdaptiveFormatUrl(playerResponse.streamingData?.adaptiveFormats);
  if (fromCurrent) {
    return fromCurrent;
  }

  const fromInitial = readPoTokenFromAdaptiveFormatUrl(window.ytInitialPlayerResponse?.streamingData?.adaptiveFormats);
  if (fromInitial) {
    return fromInitial;
  }

  return "";
}

function buildFormatId(format: AdaptiveFormatItem) {
  // YouTube's player_response sometimes calls this `lastModificationTime`;
  // current shape uses `lastModified` (microsecond timestamp string).
  const fromLastModified = format.lastModified;
  const fromLastModificationTime = getStringField(format, "lastModificationTime");
  const lastModifiedRaw = fromLastModified ?? fromLastModificationTime;
  return {
    itag: format.itag,
    lastModified: lastModifiedRaw ? String(lastModifiedRaw) : undefined,
    xtags: format.xtags
  };
}

// Synthesizes a SABR template body directly from MAIN-world player state, no
// network round-trip required. The factory iframe's player doesn't always
// fire its first SABR call before the BG times out the iframe; this builder
// reads serverAbrStreamingUrl + ustreamer config + selected format IDs +
// client info straight off the player and assembles the same protobuf body
// the player would emit.
export function buildSyntheticTemplateFromPlayer(): YtdlSabrTemplate | null {
  const player = getMoviePlayer();
  if (!player?.getPlayerResponse) {
    return null;
  }

  const playerResponse = player.getPlayerResponse();
  const streamingData = playerResponse?.streamingData;
  const url = streamingData?.serverAbrStreamingUrl;
  if (!streamingData || !url) {
    return null;
  }

  const ustreamerConfig = readUstreamerConfig(playerResponse);
  if (!ustreamerConfig) {
    return null;
  }

  const adaptiveFormats = streamingData.adaptiveFormats ?? [];
  const { audio, video } = pickHighestQualityFormats(adaptiveFormats);
  if (!audio || !video) {
    return null;
  }

  const audioFormatId = buildFormatId(audio);
  const videoFormatId = buildFormatId(video);
  const { clientName, clientVersion } = readClientInfo();
  // Prefer the real captured template's poToken (player-signed, freshly minted
  // by the YouTube player). Fall back to URL/string-derived poToken paths,
  // which are stale or empty for modern WEB clients.
  const poTokenBytes = readPoTokenFromCapturedTemplate();
  const poTokenString = poTokenBytes ? "" : findPoToken(playerResponse);

  // visitorData is intentionally omitted: googlevideo's StreamerContext.ClientInfo
  // proto schema doesn't include it (player-side it's threaded through cookies /
  // URL query, not the SABR body). The serverAbrStreamingUrl already carries the
  // visitor session.
  const body = VideoPlaybackAbrRequest.encode({
    clientAbrState: {
      playerTimeMs: "0",
      audioTrackId: audio.audioTrack?.id,
      playbackRate: DEFAULT_PLAYBACK_RATE,
      stickyResolution: video.height,
      drcEnabled: false,
      clientViewportIsFlexible: false,
      visibility: VISIBILITY_FOREGROUND,
      enabledTrackTypesBitfield: 0
    },
    selectedFormatIds: [audioFormatId, videoFormatId],
    bufferedRanges: [],
    videoPlaybackUstreamerConfig: base64UrlToUint8Array(ustreamerConfig),
    preferredAudioFormatIds: [audioFormatId],
    preferredVideoFormatIds: [videoFormatId],
    preferredSubtitleFormatIds: [],
    streamerContext: {
      sabrContexts: [],
      unsentSabrContexts: [],
      clientInfo: {
        clientName,
        clientVersion
      },
      poToken: poTokenBytes ?? (poTokenString ? base64UrlToUint8Array(poTokenString) : undefined)
    },
    field1000: []
  }).finish();

  return {
    url,
    body,
    capturedAt: Date.now()
  };
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

    crossWorldSabrMessenger.onMessage(CrossWorldSabrMessage.SynthesizeSabrTemplate, ({ data }) => {
      const synthesized = buildSyntheticTemplateFromPlayer();
      if (!synthesized) {
        return null;
      }

      const decoded = VideoPlaybackAbrRequest.decode(synthesized.body);
      if (!decoded.clientAbrState) {
        decoded.clientAbrState = ClientAbrState.decode(new Uint8Array());
      }

      decoded.clientAbrState.playerTimeMs = String(data.playerTimeMs);
      decoded.playerTimeMs = String(data.playerTimeMs);
      const mutatedBody = VideoPlaybackAbrRequest.encode(decoded).finish();
      return {
        url: synthesized.url,
        bodyBase64: uint8ToBase64(mutatedBody),
        capturedAt: synthesized.capturedAt
      };
    });

    window.__ytdlSabr = {
      hasTemplate: () => Boolean(window.__ytdlSabrTemplate),
      fetchProgressive: ({ targetDurationMs, maxIterations = 80, carryState = null }) => fetchProgressive({
        targetDurationMs,
        maxIterations,
        originalFetch,
        carryState
      }),
      synthesize: () => buildSyntheticTemplateFromPlayer()
    };

    crossWorldMessenger.onMessage(CrossWorldMessage.RunProgressiveSabr, async ({ data }) => {
      const targetDurationMs = (data.videoDurationSec ?? 0) * 1000;
      try {
        const result = await fetchProgressive({
          targetDurationMs,
          maxIterations: 80,
          originalFetch,
          carryState: null
        });
        const audioMimeType = data.audioFormat?.mimeType?.split(";")[0] ?? "audio/mp4";
        const videoMimeType = data.videoFormat?.mimeType?.split(";")[0] ?? "video/mp4";
        void crossWorldMessenger.sendMessage(CrossWorldMessage.StreamData, {
          downloadType: data.type,
          videoId: data.videoId,
          filenameOutput: data.filenameOutput,
          videoData: result.videoBytes,
          audioData: result.audioBytes,
          videoMimeType,
          audioMimeType,
          audioLabel: data.primaryAudioLabel ?? "",
          additionalAudioData: [],
          metadata: data.metadata
        });
      } catch (error) {
        void crossWorldMessenger.sendMessage(CrossWorldMessage.StreamError, {
          videoId: data.videoId,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    });
  }
});
