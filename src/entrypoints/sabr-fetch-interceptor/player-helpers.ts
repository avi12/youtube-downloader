import "./types";
import type { MoviePlayerElement } from "./types";
import { base64ToUint8Array } from "@/lib/utils/binary";
import { MOVIE_PLAYER_SELECTOR } from "@/lib/youtube/player-selectors";
import type { AdaptiveFormatItem, PlayerResponse } from "@/types";
import { VideoPlaybackAbrRequest } from "googlevideo/protos";

const DEFAULT_CLIENT_NAME = 1;
const POTOKEN_QUERY_PARAM = "pot";

export function base64UrlToUint8Array(value: string) {
  const standard = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = (4 - standard.length % 4) % 4;
  return base64ToUint8Array(standard + "=".repeat(padding));
}

export function getMoviePlayer() {
  return document.querySelector<MoviePlayerElement>(MOVIE_PLAYER_SELECTOR);
}

export function pickHighestQualityFormats(adaptiveFormats: AdaptiveFormatItem[]) {
  const audioFormats = adaptiveFormats.filter(format => format.mimeType?.startsWith("audio/"));
  const videoFormats = adaptiveFormats.filter(format => format.mimeType?.startsWith("video/"));
  const primaryAudio = audioFormats.find(format => format.audioTrack?.audioIsDefault) ?? audioFormats[0] ?? null;
  const sortedAudio = primaryAudio
    ? audioFormats
      .filter(format => format.audioTrack?.id === primaryAudio.audioTrack?.id || !format.audioTrack)
      .sort((left, right) => (right.bitrate ?? 0) - (left.bitrate ?? 0))[0]
    : null;
  // WASM FFmpeg lacks AV1 support; prefer VP9 or h264 over AV1.
  const nonAv1VideoFormats = videoFormats.filter(format => !format.mimeType?.includes("av01"));
  const preferredVideoFormats = nonAv1VideoFormats.length > 0 ? nonAv1VideoFormats : videoFormats;
  const sortedVideo = preferredVideoFormats
    .sort((left, right) => {
      const heightDelta = (right.height ?? 0) - (left.height ?? 0);
      return heightDelta !== 0 ? heightDelta : (right.bitrate ?? 0) - (left.bitrate ?? 0);
    })[0] ?? null;
  return {
    audio: sortedAudio,
    video: sortedVideo
  };
}

function readField(record: unknown, key: string) {
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

export function readUstreamerConfig(playerResponse: PlayerResponse) {
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

export function readClientInfo() {
  const ytcfgData = window.ytcfg?.data_;
  const ictx = ytcfgData?.INNERTUBE_CONTEXT?.client ?? {};
  const numericClientName = getNumericField(ytcfgData, "INNERTUBE_CONTEXT_CLIENT_NAME");
  return {
    clientName: numericClientName ?? DEFAULT_CLIENT_NAME,
    clientVersion: ictx.clientVersion ?? ""
  };
}

export function buildFormatId(format: AdaptiveFormatItem) {
  const fromLastModified = format.lastModified;
  const fromLastModificationTime = getStringField(format, "lastModificationTime");
  const lastModifiedRaw = fromLastModified ?? fromLastModificationTime;
  return {
    itag: format.itag,
    lastModified: lastModifiedRaw ? String(lastModifiedRaw) : undefined,
    xtags: format.xtags
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
      // malformed URL
    }
  }

  return "";
}

export function readPoTokenFromCapturedTemplate() {
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
    // malformed template
  }

  return null;
}

export function findPoToken(playerResponse: PlayerResponse) {
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
