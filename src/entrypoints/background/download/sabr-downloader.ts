import {
  buildEffectiveSabrConfig,
  downloadAudioOnlyViaSabr,
  downloadExtraAudioTracksViaSabr,
  downloadVideoAudioViaSabr
} from "./sabr-progress";
import { DownloadType } from "@/types";
import type { DownloadRequest } from "@/types";

export async function downloadViaSabr({ request, signal, tabId, onProgress }: {
  request: DownloadRequest;
  signal: AbortSignal;
  tabId: number;
  onProgress?: () => void;
}) {
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

  const resolvedPoToken = poToken ?? "";
  if (isAudioOnly) {
    const audioData = await downloadAudioOnlyViaSabr({
      config: effectiveConfig,
      audioFormat,
      poToken: resolvedPoToken,
      signal,
      videoId,
      tabId,
      onProgress
    });
    return {
      videoData: null,
      audioData,
      additionalAudioTracks: []
    };
  }

  if (!videoFormat) {
    return null;
  }

  const [videoData, audioData] = await downloadVideoAudioViaSabr({
    config: effectiveConfig,
    videoFormat,
    audioFormat,
    poToken: resolvedPoToken,
    signal,
    videoId,
    tabId,
    onProgress
  });
  const additionalAudioTracks = await downloadExtraAudioTracksViaSabr({
    config: effectiveConfig,
    formats: additionalAudioFormats ?? [],
    poToken: resolvedPoToken,
    signal,
    onProgress
  });

  return {
    videoData,
    audioData,
    additionalAudioTracks
  };
}
