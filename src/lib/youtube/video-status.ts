import type { PlayerResponse } from "@/types";
import { PlayabilityStatus } from "@/types/youtube";

const MUSIC_CATEGORY = "Music";

export function isVideoLive(playerResponse: PlayerResponse) {
  return Boolean(playerResponse.videoDetails?.isLive);
}

export function isVideoDownloadable(playerResponse: PlayerResponse) {
  const isLive = isVideoLive(playerResponse);
  if (isLive) {
    return false;
  }

  const { status } = playerResponse.playabilityStatus;
  const isLoginRequired = status === PlayabilityStatus.LoginRequired;
  const isError = status === PlayabilityStatus.Error;
  const isUnplayable = isLoginRequired || isError;
  if (isUnplayable) {
    return false;
  }

  const { streamingData } = playerResponse;
  const isStreamingDataMissing = !streamingData;
  if (isStreamingDataMissing) {
    return false;
  }

  const formats = streamingData.adaptiveFormats ?? [];
  const hasDirectFormats = formats.some(format => Boolean(format.url) || Boolean(format.signatureCipher));
  const hasSabrUrl = Boolean(streamingData.serverAbrStreamingUrl);
  return hasDirectFormats || hasSabrUrl;
}

// YouTube Music sends microformatDataRenderer in place of playerMicroformatRenderer
export function isVideoMusic({ microformat }: PlayerResponse) {
  const renderer = microformat?.playerMicroformatRenderer ?? microformat?.microformatDataRenderer;
  return renderer?.category === MUSIC_CATEGORY;
}
