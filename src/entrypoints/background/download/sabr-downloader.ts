import type { DownloadResult } from "./background-downloader";
import { createProgressFetch } from "./progress-fetch";
import { sendProgressUpdate } from "./progress-fetch";
import { fetchAudioViaSabrStream, fetchVideoViaSabrStream } from "@/lib/youtube/sabr-download";
import { DownloadType, ProgressType } from "@/types";
import type { AdaptiveFormatItem, DownloadRequest, SabrConfig } from "@/types";

export function buildEffectiveSabrConfig({ sabrConfig, sabrUrl }: {
  sabrConfig: SabrConfig;
  sabrUrl: string | undefined;
}): SabrConfig {
  if (sabrUrl && sabrUrl !== sabrConfig.serverAbrStreamingUrl) {
    return { ...sabrConfig, serverAbrStreamingUrl: sabrUrl };
  }

  return sabrConfig;
}

export function parseContentLength(format: AdaptiveFormatItem | null) {
  if (!format?.contentLength) {
    return 0;
  }

  return parseInt(format.contentLength, 10);
}

async function downloadAudioOnlyViaSabr({ config, audioFormat, poToken, signal, videoId, tabId, onProgress }: {
  config: SabrConfig;
  audioFormat: AdaptiveFormatItem;
  poToken: string;
  signal: AbortSignal;
  videoId: string;
  tabId: number;
  onProgress?: () => void;
}) {
  const audioExpectedBytes = parseContentLength(audioFormat);
  let audioReceivedBytes = 0;

  const sabrFetch = createProgressFetch({
    signal,
    onBytesReceived(bytes) {
      audioReceivedBytes += bytes;
      onProgress?.();
      const totalBytes = audioExpectedBytes || audioReceivedBytes;
      void sendProgressUpdate({
        videoId, progress: Math.min(audioReceivedBytes / totalBytes, 1), progressType: ProgressType.Video, tabId
      });
    }
  });

  return fetchAudioViaSabrStream({ sabrConfig: config, audioFormat, fetchFn: sabrFetch, poToken });
}

async function downloadVideoAudioViaSabr({
  config, videoFormat, audioFormat, poToken, signal, videoId, tabId, onProgress
}: {
  config: SabrConfig;
  videoFormat: AdaptiveFormatItem;
  audioFormat: AdaptiveFormatItem;
  poToken: string;
  signal: AbortSignal;
  videoId: string;
  tabId: number;
  onProgress?: () => void;
}) {
  const totalExpectedBytes = parseContentLength(videoFormat) + parseContentLength(audioFormat);
  let videoReceivedBytes = 0;
  let audioReceivedBytes = 0;

  function reportProgress() {
    const totalReceived = videoReceivedBytes + audioReceivedBytes;
    const totalExpected = totalExpectedBytes || totalReceived;
    if (totalExpected === 0) {
      return;
    }

    void sendProgressUpdate({
      videoId, progress: Math.min(totalReceived / totalExpected, 1), progressType: ProgressType.Video, tabId
    });
  }

  const videoFetch = createProgressFetch({
    signal,
    onBytesReceived(bytes) {
      videoReceivedBytes += bytes;
      onProgress?.();
      reportProgress();
    }
  });
  const audioFetch = createProgressFetch({
    signal,
    onBytesReceived(bytes) {
      audioReceivedBytes += bytes;
      onProgress?.();
      reportProgress();
    }
  });

  return Promise.all([
    fetchVideoViaSabrStream({ sabrConfig: config, videoFormat, fetchFn: videoFetch, poToken }),
    fetchAudioViaSabrStream({ sabrConfig: config, audioFormat, fetchFn: audioFetch, poToken })
  ]);
}

async function downloadExtraAudioTracksViaSabr({ config, formats, poToken, signal }: {
  config: SabrConfig;
  formats: AdaptiveFormatItem[];
  poToken: string;
  signal: AbortSignal;
}) {
  const tracks: DownloadResult["additionalAudioTracks"] = [];

  for (const format of formats) {
    try {
      const sabrFetch = createProgressFetch({ signal, onBytesReceived() {} });
      const data = await fetchAudioViaSabrStream({
        sabrConfig: config, audioFormat: format, fetchFn: sabrFetch, poToken
      });
      tracks.push({
        data,
        mimeType: format.mimeType.split(";")[0] ?? "audio/mp4",
        label: format.audioTrack?.displayName ?? ""
      });
    } catch (trackError) {
      console.warn("[ytdl:bg] Extra audio track failed:", format.audioTrack?.displayName, trackError);
    }
  }

  return tracks;
}

export async function downloadViaSabr({ request, signal, tabId, onProgress }: {
  request: DownloadRequest;
  signal: AbortSignal;
  tabId: number;
  onProgress?: () => void;
}): Promise<DownloadResult | null> {
  const { videoId, type, sabrConfig, poToken, sabrUrl, videoFormat, audioFormat, additionalAudioFormats } = request;
  const isAudioOnly = type === DownloadType.Audio;

  const effectiveConfig = sabrConfig ? buildEffectiveSabrConfig({ sabrConfig, sabrUrl }) : null;
  if (!effectiveConfig || !audioFormat) {
    return null;
  }

  if (!isAudioOnly && !videoFormat) {
    return null;
  }

  const resolvedPoToken = poToken ?? "";
  if (isAudioOnly) {
    const audioData = await downloadAudioOnlyViaSabr({
      config: effectiveConfig, audioFormat, poToken: resolvedPoToken, signal, videoId, tabId, onProgress
    });
    return { videoData: null, audioData, additionalAudioTracks: [] };
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
    config: effectiveConfig, formats: additionalAudioFormats ?? [], poToken: resolvedPoToken, signal
  });

  return { videoData, audioData, additionalAudioTracks };
}
