import { downloadAudioOnlyViaSabr, downloadExtraAudioTracksViaSabr, downloadVideoAudioViaSabr } from "./sabr-progress";
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
  const capturedUrl = capturedData?.url;
  // Only adopt the captured URL (fresh spc) — never the captured ustreamer config or body,
  // which may encode an AV1 session from Firefox's own player and cause AV1 data to be served
  // regardless of the VP9 format IDs we request.
  const urlChanged = capturedUrl && capturedUrl !== effectiveConfig.serverAbrStreamingUrl;
  const configWithCapturedUrl = urlChanged
    ? {
      ...effectiveConfig,
      serverAbrStreamingUrl: capturedUrl
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
    config: configWithCapturedUrl,
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
