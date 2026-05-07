import { createProgressFetch, sendProgressUpdate } from "./progress-fetch";
import { fetchAudioViaSabrStream } from "@/lib/youtube/sabr/download";
import { ProgressType } from "@/types";
import type { AdaptiveFormatItem, SabrConfig } from "@/types";

export function parseContentLength(format: AdaptiveFormatItem | null) {
  if (!format?.contentLength) {
    return 0;
  }

  return parseInt(format.contentLength, 10);
}

export async function downloadAudioOnlyViaSabr({
  config, audioFormat, poToken, signal, videoId, tabId, onProgress, firstBodyOverride
}: {
  config: SabrConfig;
  audioFormat: AdaptiveFormatItem;
  poToken: string;
  signal: AbortSignal;
  videoId: string;
  tabId: number;
  onProgress?: () => void;
  firstBodyOverride?: Uint8Array;
}) {
  const audioExpectedBytes = parseContentLength(audioFormat);
  let audioReceivedBytes = 0;

  const sabrFetch = createProgressFetch({
    signal,
    firstBodyOverride,
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
