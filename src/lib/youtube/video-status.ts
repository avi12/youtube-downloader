import type { PlayerResponse } from "@/types";
import { PlayabilityStatus } from "@/types/youtube";

export function isVideoLive(playerResponse: PlayerResponse) {
  return Boolean(playerResponse.videoDetails?.isLive);
}

export function isVideoDownloadable(playerResponse: PlayerResponse) {
  const isLive = isVideoLive(playerResponse);
  if (isLive) {
    return false;
  }

  const { status } = playerResponse.playabilityStatus;
  const isNotPlayable = status === PlayabilityStatus.LoginRequired || status === PlayabilityStatus.Error;
  if (isNotPlayable) {
    return false;
  }

  const { streamingData } = playerResponse;
  const isStreamingDataMissing = !streamingData;
  if (isStreamingDataMissing) {
    return false;
  }

  const formats = streamingData.adaptiveFormats ?? [];
  return formats.some(format => Boolean(format.url) || Boolean(format.signatureCipher))
    || Boolean(streamingData.serverAbrStreamingUrl);
}

export function isVideoMusic(playerResponse: PlayerResponse) {
  return playerResponse.microformat?.playerMicroformatRenderer.category === "Music";
}
