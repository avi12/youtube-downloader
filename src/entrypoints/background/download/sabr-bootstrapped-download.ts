import type { DownloadResult } from "./background-downloader";
import { createProgressFetch, sendProgressUpdate } from "./progress-fetch";
import { buildEffectiveSabrConfig, parseContentLength } from "./sabr-progress";
import { fetchVideoAudioViaSabrStreamBootstrapped } from "@/lib/youtube/sabr-download";
import { ProgressType } from "@/types";
import type { DownloadRequest } from "@/types";

const HARD_BOOTSTRAP_TIMEOUT_MS = 120_000;

export async function downloadViaSabrWithTrustTemplate({
  request, signal, tabId, onProgress, templateUrl, templateBody, onCallLog
}: {
  request: DownloadRequest;
  signal: AbortSignal;
  tabId: number;
  onProgress?: () => void;
  templateUrl: string;
  templateBody: Uint8Array;
  onCallLog?: (msg: string) => void;
}): Promise<DownloadResult | null> {
  const { videoId, sabrConfig, poToken, sabrUrl, videoFormat, audioFormat } = request;
  if (!sabrConfig || !videoFormat || !audioFormat) {
    return null;
  }

  const effectiveConfig = buildEffectiveSabrConfig({
    sabrConfig,
    sabrUrl
  });
  const videoExpectedBytes = parseContentLength(videoFormat);
  const audioExpectedBytes = parseContentLength(audioFormat);
  const totalExpectedBytes = videoExpectedBytes + audioExpectedBytes;
  let totalReceivedBytes = 0;

  const sabrFetch = createProgressFetch({
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

  const bootstrapPromise = fetchVideoAudioViaSabrStreamBootstrapped({
    sabrConfig: effectiveConfig,
    videoFormat,
    audioFormat,
    fetchFn: sabrFetch,
    poToken: poToken ?? "",
    templateUrl,
    templateBody,
    onCallLog
  });
  const timeoutPromise = new Promise<{
    videoBytes: Uint8Array;
    audioBytes: Uint8Array;
  }>(
    (_, reject) => setTimeout(
      () => reject(new Error(`bootstrap hard-timeout after ${HARD_BOOTSTRAP_TIMEOUT_MS}ms`)),
      HARD_BOOTSTRAP_TIMEOUT_MS
    )
  );

  let videoBytes: Uint8Array;
  let audioBytes: Uint8Array;
  try {
    ({ videoBytes, audioBytes } = await Promise.race([bootstrapPromise, timeoutPromise]));
  } catch (error) {
    onCallLog?.(`bootstrap timed out: ${String(error)}`);
    return null;
  }

  onCallLog?.(
    `bootstrap done: video=${videoBytes.byteLength}/${videoExpectedBytes}B `
    + `audio=${audioBytes.byteLength}/${audioExpectedBytes}B`
  );

  if (audioBytes.byteLength === 0 && videoBytes.byteLength === 0) {
    onCallLog?.("bootstrap returned 0 bytes; falling through");
    return null;
  }

  return {
    videoData: videoBytes,
    audioData: audioBytes,
    additionalAudioTracks: []
  };
}
