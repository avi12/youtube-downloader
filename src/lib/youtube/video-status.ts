import type { PlayerResponse } from "@/types";
import { PlayabilityStatus } from "@/types/youtube";

export function isVideoLive(playerResponse: PlayerResponse) {
  return Boolean(playerResponse.videoDetails?.isLive);
}

export function isVideoDownloadable(playerResponse: PlayerResponse) {
  if (isVideoLive(playerResponse)) {
    return false;
  }

  const { status } = playerResponse.playabilityStatus;
  if (status === PlayabilityStatus.LoginRequired || status === PlayabilityStatus.Error) {
    return false;
  }

  const { streamingData } = playerResponse;
  if (!streamingData) {
    return false;
  }

  const formats = streamingData.adaptiveFormats ?? [];
  return formats.some(format => Boolean(format.url) || Boolean(format.signatureCipher))
    || Boolean(streamingData.serverAbrStreamingUrl);
}

export function isVideoMusic(playerResponse: PlayerResponse) {
  return playerResponse.microformat?.playerMicroformatRenderer.category === "Music";
}
