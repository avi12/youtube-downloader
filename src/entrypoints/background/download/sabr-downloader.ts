import type { DownloadResult } from "./background-downloader";
import {
  downloadAudioOnlyViaSabr,
  downloadVideoAudioViaSabr,
  downloadExtraAudioTracksViaSabr
} from "./sabr-fetch-helpers";
import { createProgressAccumulator } from "./sabr-progress";
import { buildEffectiveSabrConfig } from "./sabr-utils";
import { DownloadType } from "@/types";
import type { DownloadRequest } from "@/types";

export { parseContentLength, buildEffectiveSabrConfig } from "./sabr-utils";

export async function downloadViaSabr({ request, signal, tabId, onProgress }: {
  request: DownloadRequest;
  signal: AbortSignal;
  tabId: number;
  onProgress?: () => void;
}): Promise<DownloadResult | null> {
  const { videoId, type, sabrConfig, poToken, sabrUrl, videoFormat, audioFormat, additionalAudioFormats } = request;
  const isAudioOnly = type === DownloadType.Audio;

  const effectiveConfig = sabrConfig ? buildEffectiveSabrConfig({
    sabrConfig,
    sabrUrl
  }) : null;
  if (!effectiveConfig || !audioFormat) {
    return null;
  }

  if (!isAudioOnly && !videoFormat) {
    return null;
  }

  const captionCount = request.captionTracks?.length ?? 0;
  const additionalFormats = additionalAudioFormats ?? [];
  const resolvedPoToken = poToken ?? "";

  const { onVideoBytes, onAudioBytes, onExtraTrackBytes } = createProgressAccumulator({
    videoId,
    tabId,
    captionCount,
    isAudioOnly,
    videoFormat: videoFormat ?? null,
    audioFormat,
    additionalFormats,
    onProgress
  });
  if (isAudioOnly) {
    const audioResult = await downloadAudioOnlyViaSabr({
      config: effectiveConfig,
      audioFormat,
      poToken: resolvedPoToken,
      signal,
      onBytesReceived: onAudioBytes
    });
    return {
      videoData: null,
      audioData: audioResult.data,
      additionalAudioTracks: [],
      isPartialAudio: !audioResult.isComplete
    };
  }

  if (!videoFormat) {
    return null;
  }

  const [videoResult, audioResult] = await downloadVideoAudioViaSabr({
    config: effectiveConfig,
    videoFormat,
    audioFormat,
    poToken: resolvedPoToken,
    signal,
    onVideoBytesReceived: onVideoBytes,
    onAudioBytesReceived: onAudioBytes
  });
  const additionalAudioTracks = await downloadExtraAudioTracksViaSabr({
    config: effectiveConfig,
    formats: additionalFormats,
    poToken: resolvedPoToken,
    signal,
    onTrackBytesReceived: onExtraTrackBytes
  });

  return {
    videoData: videoResult.data,
    audioData: audioResult.data,
    additionalAudioTracks,
    isPartialVideo: !videoResult.isComplete,
    isPartialAudio: !audioResult.isComplete
  };
}
