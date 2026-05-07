import { buildFormatId, getMoviePlayer } from "./player-helpers";
import { waitForTemplate } from "./template-builder";
import type {
  FormatProgress,
  ProgressiveCarryState,
  ProgressiveFetchResult,
  ProgressiveState,
  SabrContextEntry
} from "./types";
import type { AdaptiveFormatItem } from "@/types";
import {
  ClientAbrState,
  FormatId,
  MediaHeader,
  NextRequestPolicy,
  PlaybackCookie,
  SabrContextUpdate,
  SabrContextWritePolicy,
  SabrError,
  SabrRedirect,
  StreamerContext,
  StreamProtectionStatus,
  UMPPartId,
  VideoPlaybackAbrRequest
} from "googlevideo/protos";
import { CompositeBuffer, UmpReader } from "googlevideo/ump";

const STALL_LIMIT = 50;
const SPS3_REFRESH_AFTER = 2;

function buildRequestBody({
  templateBody, playerTimeMs, audio, video, playbackCookieBytes,
  audioFormatId, videoFormatId, sabrContexts, activeSabrContextTypes
}: {
  templateBody: Uint8Array;
  playerTimeMs: number;
  audio: FormatProgress;
  video: FormatProgress;
  playbackCookieBytes: Uint8Array | null;
  audioFormatId: FormatId | undefined;
  videoFormatId: FormatId | undefined;
  sabrContexts: Map<number, SabrContextEntry>;
  activeSabrContextTypes: Set<number>;
}) {
  const decoded = VideoPlaybackAbrRequest.decode(templateBody);
  decoded.playerTimeMs = String(playerTimeMs);

  if (!decoded.clientAbrState) {
    decoded.clientAbrState = ClientAbrState.decode(new Uint8Array());
  }

  decoded.clientAbrState.playerTimeMs = String(playerTimeMs);

  if (audioFormatId && videoFormatId) {
    decoded.selectedFormatIds = [audioFormatId, videoFormatId];
    decoded.preferredAudioFormatIds = [audioFormatId];
    decoded.preferredVideoFormatIds = [videoFormatId];
  }

  decoded.bufferedRanges = [];

  for (const formatId of decoded.selectedFormatIds) {
    let target: FormatProgress | null = null;
    if (formatId.itag === audio.itag) {
      target = audio;
    } else if (formatId.itag === video.itag) {
      target = video;
    }

    if (target && target.endMs > 0) {
      const segDurationMs = target.lastSegDurationMs > 0 ? target.lastSegDurationMs : target.endMs;
      (window.__ytdlDebugLog ??= []).push("buffered-range itag=" + formatId.itag + " segDur=" + segDurationMs + " lastSeq=" + target.lastSeq + " endMs=" + target.endMs);
      decoded.bufferedRanges.push({
        formatId,
        startTimeMs: "0",
        durationMs: String(segDurationMs),
        startSegmentIndex: target.lastSeq,
        endSegmentIndex: target.lastSeq
      });
    }
  }

  if (!decoded.streamerContext) {
    decoded.streamerContext = StreamerContext.decode(new Uint8Array());
  }

  decoded.streamerContext.playbackCookie = playbackCookieBytes ?? undefined;

  decoded.streamerContext.sabrContexts = [...sabrContexts.entries()]
    .filter(([type]) => activeSabrContextTypes.has(type))
    .map(([, ctx]) => ({
      type: ctx.type,
      value: ctx.value
    }));
  decoded.streamerContext.unsentSabrContexts = [...sabrContexts.keys()]
    .filter(type => !activeSabrContextTypes.has(type));

  return VideoPlaybackAbrRequest.encode(decoded).finish();
}

async function performFetch({ url, body, requestNumber, authorization }: {
  url: string;
  body: Uint8Array;
  requestNumber: number;
  authorization?: string;
}) {
  const fresh = new Uint8Array(body.byteLength);
  fresh.set(body);
  const sabrUrl = new URL(url);
  sabrUrl.searchParams.set("rn", String(requestNumber));
  sabrUrl.searchParams.set("alr", "yes");
  const response = await globalThis.fetch(sabrUrl.toString(), {
    method: "POST",
    body: fresh,
    mode: "cors",
    credentials: "include",
    signal: AbortSignal.timeout(30_000),
    ...(authorization && {
      headers: {
        Authorization: authorization
      }
    })
  });
  if (!response.ok) {
    console.error("[ytdl:progressive] fetch-url=" + sabrUrl.toString().slice(0, 300) + " status=" + response.status);

    if (response.status === 403) {
      return null;
    }

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

function ingestUmpResponse({ response, audio, video, audioItag, videoItag, state }: {
  response: Uint8Array;
  audio: FormatProgress;
  video: FormatProgress;
  audioItag: number;
  videoItag: number;
  state: ProgressiveState;
}): {
  nextRequestPolicyBytes: Uint8Array | null;
  redirectUrl: string | null;
  streamProtectionStatus: number;
  receivedReloadPlayerResponse: boolean;
} {
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
  let redirectUrl: string | null = null;
  let streamProtectionStatus = 0;
  let receivedReloadPlayerResponse = false;
  reader.read((part: {
    type: number;
    size: number;
    data: CompositeBuffer;
  }) => {
    const partBytes = compositeBufferToUint8(part.data);
    (window.__ytdlDebugLog ??= []).push("ump-part type=" + part.type + " size=" + part.size);

    if (part.type === UMPPartId.MEDIA_HEADER) {
      const header = MediaHeader.decode(partBytes);
      const itag = header.itag ?? -1;
      const startMs = parseInt(header.startMs ?? "0", 10);
      const durMs = parseInt(header.durationMs ?? "0", 10);
      const endMs = startMs + durMs;
      const seq = header.sequenceNumber ?? 0;
      (window.__ytdlDebugLog ??= []).push("media-hdr itag=" + itag + " seq=" + seq + " start=" + startMs + " end=" + endMs + " hid=" + (header.headerId ?? 0));
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
          target.lastSegDurationMs = durMs;
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
    } else if (part.type === UMPPartId.SABR_CONTEXT_UPDATE) {
      try {
        const update = SabrContextUpdate.decode(partBytes);
        (window.__ytdlDebugLog ??= []).push("sabr-ctx-update type=" + update.type + " sendByDefault=" + update.sendByDefault + " scope=" + update.scope + " writePolicy=" + update.writePolicy + " valLen=" + (update.value?.length ?? 0));

        if (update.type !== undefined && update.type !== 0 && update.value?.length) {
          const isNew = !state.sabrContexts.has(update.type);
          const shouldOverwrite = update.writePolicy !== SabrContextWritePolicy.KEEP_EXISTING;
          if (isNew || shouldOverwrite) {
            state.sabrContexts.set(update.type, {
              type: update.type,
              value: update.value,
              sendByDefault: update.sendByDefault ?? false
            });
          }

          if (update.sendByDefault) {
            state.activeSabrContextTypes.add(update.type);
          }
        }
      } catch (ctxErr) {
        (window.__ytdlDebugLog ??= []).push("sabr-ctx-ERR b0=" + partBytes[0] + " len=" + partBytes.byteLength + " err=" + String(ctxErr).slice(0, 60));
      }
    } else if (part.type === UMPPartId.NEXT_REQUEST_POLICY) {
      nextRequestPolicyBytes = partBytes;
    } else if (part.type === UMPPartId.SABR_REDIRECT) {
      try {
        const redirect = SabrRedirect.decode(partBytes);
        if (redirect.url) {
          redirectUrl = redirect.url;
          (window.__ytdlDebugLog ??= []).push("sabr-redirect url=" + redirect.url.slice(0, 200));
        }
      } catch {
        // ignore malformed redirect
      }
    } else if (part.type === UMPPartId.SABR_ERROR) {
      try {
        const error = SabrError.decode(partBytes);
        console.error("[ytdl:progressive] sabr-error type=" + error.type + " code=" + error.code);
        (window.__ytdlDebugLog ??= []).push("sabr-error type=" + error.type + " code=" + error.code);
      } catch {
        (window.__ytdlDebugLog ??= []).push("sabr-error (unparseable len=" + partBytes.byteLength + ")");
      }
    } else if (part.type === UMPPartId.STREAM_PROTECTION_STATUS) {
      try {
        const sps = StreamProtectionStatus.decode(partBytes);
        streamProtectionStatus = sps.status ?? 0;
        (window.__ytdlDebugLog ??= []).push("stream-protection status=" + streamProtectionStatus + " maxRetries=" + (sps.maxRetries ?? 0));
      } catch {
        (window.__ytdlDebugLog ??= []).push("stream-protection (unparseable)");
      }
    } else if (part.type === UMPPartId.RELOAD_PLAYER_RESPONSE) {
      receivedReloadPlayerResponse = true;
      (window.__ytdlDebugLog ??= []).push("reload-player-response len=" + partBytes.byteLength);
    } else if (part.type === UMPPartId.SNACKBAR_MESSAGE) {
      console.error("[ytdl:progressive] sabr-snackbar len=" + partBytes.byteLength + " bytes=" + Array.from(partBytes).join(","));
      (window.__ytdlDebugLog ??= []).push("sabr-snackbar len=" + partBytes.byteLength);
    }
  });
  return {
    nextRequestPolicyBytes,
    redirectUrl,
    streamProtectionStatus,
    receivedReloadPlayerResponse
  };
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

function buildResult({ state, audioItag, videoItag, iterations, isStalled, needsTemplateRefresh = false }: {
  state: ProgressiveState;
  audioItag: number;
  videoItag: number;
  iterations: number;
  isStalled: boolean;
  needsTemplateRefresh?: boolean;
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
    needsTemplateRefresh,
    carryState: {
      audioEndMs: state.audio.endMs,
      audioLastSeq: state.audio.lastSeq,
      audioLastSegDurationMs: state.audio.lastSegDurationMs,
      videoEndMs: state.video.endMs,
      videoLastSeq: state.video.lastSeq,
      videoLastSegDurationMs: state.video.lastSegDurationMs,
      audioSegmentBytes: state.audio.segmentBytes,
      videoSegmentBytes: state.video.segmentBytes,
      playbackCookieBytes: state.playbackCookieBytes,
      sabrContexts: state.sabrContexts,
      activeSabrContextTypes: state.activeSabrContextTypes
    }
  };
}

function updatePlaybackCookie(state: ProgressiveState, nextRequestPolicyBytes: Uint8Array | null): number {
  if (!nextRequestPolicyBytes) {
    return 0;
  }

  try {
    const policy = NextRequestPolicy.decode(nextRequestPolicyBytes);
    (window.__ytdlDebugLog ??= []).push("nrp backoffMs=" + (policy.backoffTimeMs ?? 0) + " maxTimeSinceLastReqMs=" + (policy.maxTimeSinceLastRequestMs ?? 0) + " targetAudioReadaheadMs=" + (policy.targetAudioReadaheadMs ?? 0));

    if (policy.playbackCookie) {
      state.playbackCookieBytes = PlaybackCookie.encode(policy.playbackCookie).finish();
    }

    return policy.backoffTimeMs ?? 0;
  } catch (_) {
    return 0;
  }
}

type IterationContext = {
  state: ProgressiveState;
  activeTemplateBody: Uint8Array;
  activeTemplateUrl: string;
  playerTimeMs: number;
  audioItag: number;
  videoItag: number;
  audioFormatId: FormatId | undefined;
  videoFormatId: FormatId | undefined;
  authorization?: string;
  urlOverride?: string;
};

const IterationResultKind = {
  StallExit: "stall-exit",
  Complete: "complete",
  Advance: "advance",
  StallRetry: "stall-retry",
  TemplateRefreshNeeded: "template-refresh-needed"
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
    templateUrl: string;
  }
  | {
    kind: typeof IterationResultKind.TemplateRefreshNeeded;
    result: ProgressiveFetchResult;
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
  const {
    state, activeTemplateBody, activeTemplateUrl, playerTimeMs,
    audioItag, videoItag, audioFormatId, videoFormatId, authorization
  } = ctx;

  const requestBody = buildRequestBody({
    templateBody: activeTemplateBody,
    playerTimeMs,
    audio: state.audio,
    video: state.video,
    playbackCookieBytes: state.playbackCookieBytes,
    audioFormatId,
    videoFormatId,
    sabrContexts: state.sabrContexts,
    activeSabrContextTypes: state.activeSabrContextTypes
  });

  const fetchResult = await performFetch({
    url: activeTemplateUrl,
    body: requestBody,
    requestNumber: iteration + 1,
    authorization
  });
  if (fetchResult === null) {
    return {
      kind: IterationResultKind.TemplateRefreshNeeded,
      result: buildResult({
        state,
        audioItag,
        videoItag,
        iterations: iteration + 1,
        isStalled: false,
        needsTemplateRefresh: true
      })
    };
  }

  const response = fetchResult;
  console.error("[ytdl:progressive] iter=" + iteration + " rn=" + (iteration + 1) + " resLen=" + response.byteLength + " audioItag=" + audioItag + " videoItag=" + videoItag);
  (window.__ytdlDebugLog ??= []).push("iter=" + iteration + " rn=" + (iteration + 1) + " resLen=" + response.byteLength + " t=" + Date.now());
  const beforeAudioEnd = state.audio.endMs;
  const beforeVideoEnd = state.video.endMs;
  const {
    nextRequestPolicyBytes, redirectUrl, streamProtectionStatus, receivedReloadPlayerResponse
  } = ingestUmpResponse({
    response,
    audio: state.audio,
    video: state.video,
    audioItag,
    videoItag,
    state
  });
  const backoffTimeMs = updatePlaybackCookie(state, nextRequestPolicyBytes);
  if (backoffTimeMs > 0) {
    await new Promise<void>(resolve => setTimeout(resolve, backoffTimeMs));
  }

  const isAdvanced = state.audio.endMs > beforeAudioEnd || state.video.endMs > beforeVideoEnd;
  console.error("[ytdl:progressive] iter=" + iteration + " audioEnd=" + state.audio.endMs + " videoEnd=" + state.video.endMs + " adv=" + isAdvanced + " sps=" + streamProtectionStatus + " debugLog=" + JSON.stringify(window.__ytdlDebugLog?.slice(-6) ?? []));
  (window.__ytdlDebugLog ??= []).push("iter=" + iteration + " audioEnd=" + state.audio.endMs + " videoEnd=" + state.video.endMs + " adv=" + isAdvanced);

  const resolvedTemplateUrl = redirectUrl ?? activeTemplateUrl;
  if (!isAdvanced) {
    if (receivedReloadPlayerResponse) {
      return {
        kind: IterationResultKind.TemplateRefreshNeeded,
        result: buildResult({
          state,
          audioItag,
          videoItag,
          iterations: iteration + 1,
          isStalled: false,
          needsTemplateRefresh: true
        })
      };
    }

    // sps=3 permanently blocks the session URL after ~70s. After a couple of
    // StallRetry attempts (respecting the server backoff), escalate to
    // TemplateRefreshNeeded so the outer loop can capture a fresh player URL.
    if (streamProtectionStatus === 3 && stallStreak >= SPS3_REFRESH_AFTER) {
      return {
        kind: IterationResultKind.TemplateRefreshNeeded,
        result: buildResult({
          state,
          audioItag,
          videoItag,
          iterations: iteration + 1,
          isStalled: false,
          needsTemplateRefresh: true
        })
      };
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
      nextPlayerTimeMs: Math.min(state.audio.endMs, state.video.endMs),
      templateBody: activeTemplateBody,
      templateUrl: resolvedTemplateUrl
    };
  }

  if (state.audio.endMs >= targetDurationMs && state.video.endMs >= targetDurationMs) {
    return { kind: IterationResultKind.Complete };
  }

  return {
    kind: IterationResultKind.Advance,
    nextPlayerTimeMs: Math.min(state.audio.endMs, state.video.endMs),
    templateUrl: resolvedTemplateUrl
  };
}

export async function fetchProgressive({
  targetDurationMs,
  maxIterations,
  carryState,
  initialPlayerTimeMs,
  urlOverride,
  audioFormat,
  videoFormat,
  authorization
}: {
  targetDurationMs: number;
  maxIterations: number;
  carryState: ProgressiveCarryState | null;
  initialPlayerTimeMs?: number;
  urlOverride?: string;
  audioFormat?: AdaptiveFormatItem | null;
  videoFormat?: AdaptiveFormatItem | null;
  authorization?: string;
}) {
  const template = await waitForTemplate({
    timeoutMs: 30_000,
    urlOverride
  });
  const initial = VideoPlaybackAbrRequest.decode(template.body);
  if (initial.selectedFormatIds.length < 2) {
    throw new Error(`SABR template needs audio + video formats; got ${initial.selectedFormatIds.length}`);
  }

  let audioItag: number;
  let videoItag: number;
  let audioFormatId: FormatId | undefined;
  let videoFormatId: FormatId | undefined;
  if (audioFormat?.itag && videoFormat?.itag) {
    const player = getMoviePlayer();
    const playerResponse = player?.getPlayerResponse ? player.getPlayerResponse() : null;
    const playerFormats = playerResponse?.streamingData?.adaptiveFormats ?? [];

    // The template's video itag tells us which codec family this SABR session uses.
    // Switching codec families mid-session (e.g. VP9 session → H.264 format) causes
    // sabr.malformed_config, so find a player-native format in the same codec at the
    // requested height instead of using the alternate-client itag directly.
    const templateVideoItag = initial.preferredVideoFormatIds[0]?.itag ?? -1;
    const templateVideoMime = playerFormats.find(fmt => fmt.itag === templateVideoItag)?.mimeType ?? "";
    const isVp9Session = templateVideoMime.includes("vp9");
    const requestedHeight = videoFormat.height ?? 0;

    const playerVideoFormat = playerFormats
      .filter(fmt => fmt.mimeType?.startsWith("video/"))
      .filter(fmt => {
        // WASM FFmpeg lacks AV1 support; exclude AV1 from all sessions.
        if (fmt.mimeType?.includes("av01")) {
          return false;
        }

        return isVp9Session ? fmt.mimeType?.includes("vp9") : true;
      })
      .sort((fmtA, fmtB) =>
        Math.abs((fmtA.height ?? 0) - requestedHeight) - Math.abs((fmtB.height ?? 0) - requestedHeight))[0];

    // Alternate-client audio may carry wrong xtags (e.g. a dubbed track). Use the
    // player's own format entry for the same itag, preferring the default audio track.
    const requestedAudioItag = audioFormat.itag;
    const playerAudioFormat = playerFormats.find(
      fmt => fmt.itag === requestedAudioItag && fmt.audioTrack?.audioIsDefault
    ) ?? playerFormats.find(fmt => fmt.itag === requestedAudioItag && !fmt.audioTrack)
      ?? playerFormats.find(fmt => fmt.itag === requestedAudioItag);
    if (playerVideoFormat && playerAudioFormat) {
      audioItag = playerAudioFormat.itag ?? requestedAudioItag;
      videoItag = playerVideoFormat.itag ?? videoFormat.itag;
      audioFormatId = buildFormatId(playerAudioFormat);
      videoFormatId = buildFormatId(playerVideoFormat);
    } else {
      audioItag = initial.preferredAudioFormatIds[0]?.itag ?? initial.selectedFormatIds[0]?.itag ?? -1;
      videoItag = initial.preferredVideoFormatIds[0]?.itag ?? initial.selectedFormatIds[1]?.itag ?? -1;
    }
  } else {
    audioItag = initial.preferredAudioFormatIds[0]?.itag ?? initial.selectedFormatIds[0]?.itag ?? -1;
    videoItag = initial.preferredVideoFormatIds[0]?.itag ?? initial.selectedFormatIds[1]?.itag ?? -1;
  }

  const state: ProgressiveState = {
    audio: {
      itag: audioItag,
      endMs: carryState?.audioEndMs ?? 0,
      lastSeq: carryState?.audioLastSeq ?? 0,
      lastSegDurationMs: carryState?.audioLastSegDurationMs ?? 0,
      segmentBytes: new Map(carryState?.audioSegmentBytes ?? [])
    },
    video: {
      itag: videoItag,
      endMs: carryState?.videoEndMs ?? 0,
      lastSeq: carryState?.videoLastSeq ?? 0,
      lastSegDurationMs: carryState?.videoLastSegDurationMs ?? 0,
      segmentBytes: new Map(carryState?.videoSegmentBytes ?? [])
    },
    playbackCookieBytes: carryState?.playbackCookieBytes ?? null,
    sabrContexts: new Map(carryState?.sabrContexts ?? []),
    activeSabrContextTypes: new Set(carryState?.activeSabrContextTypes ?? [])
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
        audioFormatId,
        videoFormatId,
        urlOverride,
        authorization
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
      playerTimeMs = Math.max(iterResult.nextPlayerTimeMs, initialPlayerTimeMs ?? 0);
      activeTemplateBody = iterResult.templateBody;
      activeTemplateUrl = iterResult.templateUrl;
      continue;
    }

    if (iterResult.kind === IterationResultKind.TemplateRefreshNeeded) {
      return iterResult.result;
    }

    stallStreak = 0;
    playerTimeMs = Math.max(iterResult.nextPlayerTimeMs, initialPlayerTimeMs ?? 0);
    activeTemplateUrl = iterResult.templateUrl;
  }

  return buildResult({
    state,
    audioItag,
    videoItag,
    iterations: iteration + 1,
    isStalled: false
  });
}
