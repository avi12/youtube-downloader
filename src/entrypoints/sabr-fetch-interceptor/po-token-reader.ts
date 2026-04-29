import type { AdaptiveFormatItem, PlayerResponse } from "@/types";
import { VideoPlaybackAbrRequest } from "googlevideo/protos";

const POTOKEN_QUERY_PARAM = "pot";

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

export function readPoTokenFromCapturedTemplate(): Uint8Array | null {
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
    // template was malformed somehow - fall through
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
