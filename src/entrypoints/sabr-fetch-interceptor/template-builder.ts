import {
  base64UrlToUint8Array,
  buildFormatId,
  findPoToken,
  getMoviePlayer,
  pickHighestQualityFormats,
  readClientInfo,
  readPoTokenFromCapturedTemplate,
  readUstreamerConfig
} from "./player-helpers";
import { uint8ToBase64 } from "@/lib/utils/binary";
import type { AdaptiveFormatItem, SabrConfig, YtdlSabrTemplate } from "@/types";
import { VideoPlaybackAbrRequest } from "googlevideo/protos";

const VISIBILITY_FOREGROUND = 1;
const DEFAULT_PLAYBACK_RATE = 1;
const POLL_INTERVAL_MS = 100;

export function buildSyntheticTemplateFromPlayer() {
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
  const poTokenBytes = readPoTokenFromCapturedTemplate();
  const poTokenString = poTokenBytes ? "" : findPoToken(playerResponse);

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

export function buildTemplateFromSabrConfig({
  sabrConfig,
  audioFormat,
  videoFormat,
  poToken
}: {
  sabrConfig: SabrConfig;
  audioFormat: AdaptiveFormatItem;
  videoFormat: AdaptiveFormatItem;
  poToken?: string;
}): YtdlSabrTemplate {
  const audioFormatId = buildFormatId(audioFormat);
  const videoFormatId = buildFormatId(videoFormat);
  const capturedPoTokenBytes = readPoTokenFromCapturedTemplate();
  const poTokenFromArg = poToken ? base64UrlToUint8Array(poToken) : undefined;
  const resolvedPoToken = capturedPoTokenBytes ?? poTokenFromArg;

  const body = VideoPlaybackAbrRequest.encode({
    clientAbrState: {
      playerTimeMs: "0",
      audioTrackId: audioFormat.audioTrack?.id,
      playbackRate: DEFAULT_PLAYBACK_RATE,
      stickyResolution: videoFormat.height,
      drcEnabled: false,
      clientViewportIsFlexible: false,
      visibility: VISIBILITY_FOREGROUND,
      enabledTrackTypesBitfield: 0
    },
    selectedFormatIds: [audioFormatId, videoFormatId],
    bufferedRanges: [],
    videoPlaybackUstreamerConfig: base64UrlToUint8Array(sabrConfig.videoPlaybackUstreamerConfig),
    preferredAudioFormatIds: [audioFormatId],
    preferredVideoFormatIds: [videoFormatId],
    preferredSubtitleFormatIds: [],
    streamerContext: {
      sabrContexts: [],
      unsentSabrContexts: [],
      clientInfo: {
        clientName: sabrConfig.clientName,
        clientVersion: sabrConfig.clientVersion
      },
      poToken: resolvedPoToken
    },
    field1000: []
  }).finish();

  return {
    url: sabrConfig.serverAbrStreamingUrl,
    body,
    capturedAt: Date.now()
  };
}

export function capturedTemplateToBase64(template: YtdlSabrTemplate) {
  return {
    url: template.url,
    bodyBase64: uint8ToBase64(template.body),
    capturedAt: template.capturedAt
  };
}

export async function waitForTemplate({ timeoutMs, urlOverride }: {
  timeoutMs: number;
  urlOverride?: string;
}) {
  const deadlineAt = Date.now() + timeoutMs;
  while (Date.now() < deadlineAt) {
    const template = window.__ytdlSabrTemplate;
    if (template) {
      return urlOverride ? {
        ...template,
        url: urlOverride
      } : template;
    }

    const synthesized = buildSyntheticTemplateFromPlayer();
    if (synthesized) {
      const resolved = urlOverride ? {
        ...synthesized,
        url: urlOverride
      } : synthesized;
      window.__ytdlSabrTemplate = resolved;
      return resolved;
    }

    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error("no SABR template captured within timeout");
}
