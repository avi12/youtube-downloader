import { createProgressFetch, sendProgressUpdate } from "./progress-fetch";
import { parseContentLength } from "./sabr-progress";
import { fetchAudioViaSabrStream, fetchVideoViaSabrStream } from "@/lib/youtube/sabr/download";
import { ProgressType } from "@/types";
import type { AdaptiveFormatItem, SabrConfig } from "@/types";

export async function downloadVideoAudioViaSabr({
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
  const videoExpectedBytes = parseContentLength(videoFormat);
  const audioExpectedBytes = parseContentLength(audioFormat);
  const totalExpectedBytes = videoExpectedBytes + audioExpectedBytes;
  let totalReceivedBytes = 0;

  function makeProgressFetch() {
    return createProgressFetch({
      signal,
      onBytesReceived(bytes) {
        totalReceivedBytes += bytes;
        onProgress?.();

        if (totalExpectedBytes > 0) {
          void sendProgressUpdate({
            videoId,
            progress: Math.min(totalReceivedBytes / totalExpectedBytes, 1),
            progressType: ProgressType.Video,
            tabId
          });
        }
      }
    });
  }

  return Promise.all([
    fetchVideoViaSabrStream({
      sabrConfig: config,
      videoFormat,
      fetchFn: makeProgressFetch(),
      poToken
    }),
    fetchAudioViaSabrStream({
      sabrConfig: config,
      audioFormat,
      fetchFn: makeProgressFetch(),
      poToken
    })
  ]);
}
