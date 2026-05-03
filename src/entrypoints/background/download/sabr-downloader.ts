import { downloadAudioOnlyViaSabr, downloadExtraAudioTracksViaSabr, downloadVideoAudioViaSabr } from "./sabr-progress";
import { extractUstreamerConfigFromBody } from "@/lib/youtube/sabr/proto-parser";
import { extractPoTokenFromBody, getCapturedSabrData } from "@/lib/youtube/sabr/request-capture";
import { DownloadType } from "@/types";
import type { DownloadRequest } from "@/types";

export async function downloadViaSabr({ request, signal, tabId, onProgress }: {
  request: DownloadRequest;
  signal: AbortSignal;
  tabId: number;
  onProgress?: () => void;
}) {
  const { videoId, type, sabrConfig, poToken, videoFormat, audioFormat, additionalAudioFormats } = request;
  const isAudioOnly = type === DownloadType.Audio;

  const effectiveConfig = sabrConfig ?? null;
  if (!effectiveConfig || !audioFormat) {
    return null;
  }

  if (!isAudioOnly && !videoFormat) {
    return null;
  }

  const capturedData = getCapturedSabrData(tabId);
  const capturedPoToken = capturedData ? extractPoTokenFromBody(capturedData.body) : null;
  const resolvedPoToken = poToken || capturedPoToken || "";
  const capturedBody = capturedData ? new Uint8Array(capturedData.body) : undefined;
  const capturedUrl = capturedData?.url;
  const capturedUstreamerConfig = capturedData ? extractUstreamerConfigFromBody(capturedData.body) : null;
  const urlChanged = capturedUrl && capturedUrl !== effectiveConfig.serverAbrStreamingUrl;
  const configChanged = capturedUstreamerConfig
    && capturedUstreamerConfig !== effectiveConfig.videoPlaybackUstreamerConfig;
  const configWithCapturedUrl = (urlChanged || configChanged)
    ? {
      ...effectiveConfig,
      ...(urlChanged && {
        serverAbrStreamingUrl: capturedUrl
      }),
      ...(configChanged && {
        videoPlaybackUstreamerConfig: capturedUstreamerConfig
      })
    }
    : effectiveConfig;
  if (isAudioOnly) {
    const audioData = await downloadAudioOnlyViaSabr({
      config: configWithCapturedUrl,
      audioFormat,
      poToken: resolvedPoToken,
      signal,
      videoId,
      tabId,
      onProgress,
      firstBodyOverride: capturedBody
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
    config: configWithCapturedUrl,
    videoFormat,
    audioFormat,
    poToken: resolvedPoToken,
    signal,
    videoId,
    tabId,
    onProgress,
    firstBodyOverride: capturedBody
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
