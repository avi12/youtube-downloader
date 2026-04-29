import { buildRequestBody, performFetch } from "./progressive-request";
import { buildResult } from "./progressive-result";
import { waitForTemplate } from "./progressive-template";
import { buildSyntheticTemplateFromPlayer } from "./template-builder";
import type { ProgressiveCarryState, ProgressiveFetchResult, ProgressiveState } from "./types";
import { ingestUmpResponse } from "./ump-ingestion";
import { NextRequestPolicy, PlaybackCookie, VideoPlaybackAbrRequest } from "googlevideo/protos";

const STALL_LIMIT = 3;
const STALL_REWIND_MS = 5_000;

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
