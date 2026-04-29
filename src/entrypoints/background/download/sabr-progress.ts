import { createProgressFetch, sendProgressUpdate } from "./progress-fetch";
import { fetchAudioViaSabrStream } from "@/lib/youtube/sabr-download";
import { ProgressType } from "@/types";
import type { AdaptiveFormatItem, SabrConfig } from "@/types";

export function buildEffectiveSabrConfig({ sabrConfig, sabrUrl }: {
  sabrConfig: SabrConfig;
  sabrUrl: string | undefined;
}): SabrConfig {
  if (sabrUrl && sabrUrl !== sabrConfig.serverAbrStreamingUrl) {
    return {
      ...sabrConfig,
      serverAbrStreamingUrl: sabrUrl
    };
  }

  return sabrConfig;
}

export function parseContentLength(format: AdaptiveFormatItem | null) {
  if (!format?.contentLength) {
    return 0;
  }

  return parseInt(format.contentLength, 10);
}

export async function downloadAudioOnlyViaSabr({ config, audioFormat, poToken, signal, videoId, tabId, onProgress }: {
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
        videoId,
        progress: Math.min(audioReceivedBytes / totalBytes, 1),
        progressType: ProgressType.Video,
        tabId
      });
    }
  });

  return fetchAudioViaSabrStream({
    sabrConfig: config,
    audioFormat,
    fetchFn: sabrFetch,
    poToken
  });
}

export { downloadVideoAudioViaSabr } from "./sabr-video-audio-download";
export { downloadExtraAudioTracksViaSabr } from "./sabr-extra-tracks";
