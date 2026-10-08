import { downloadViaWatchPage } from "./iframe-downloader";
import { downloadViaSabr } from "./sabr-downloader";
import { createSabrStallTimer } from "./sabr-stall-timer";
import { MessageType, sendMessageToTab } from "@/lib/messaging/messaging";
import { createLogger, LogScope } from "@/lib/utils/logger";
import { ProgressType } from "@/types";
import type { DownloadRequest, Prettify, VideoTabParams } from "@/types";

const log = createLogger(LogScope.Background);

const MAX_IFRAME_AUTO_RETRIES = 2;
const iframeAutoRetries = new Map<string, number>();

export function clearIframeAutoRetry(videoId: string) {
  iframeAutoRetries.delete(videoId);
}

type AttemptSabrDownloadParams = Prettify<{
  request: DownloadRequest;
  signal: AbortSignal;
  tabId: number;
}>;
export async function attemptSabrDownload({ request, signal, tabId }: AttemptSabrDownloadParams) {
  const stallTimer = createSabrStallTimer(signal);

  try {
    return downloadViaSabr({
      request,
      signal: stallTimer.signal,
      tabId,
      onProgress: stallTimer.onProgress
    });
  } finally {
    stallTimer.cleanup();
  }
}

type HandleIframeFallbackParams = Prettify<{
  request: DownloadRequest;
  tabId: number;
  videoId: string;
  onExhausted: (params: VideoTabParams) => void;
}>;
export async function handleIframeFallback({
  request, tabId, videoId, onExhausted
}: HandleIframeFallbackParams) {
  if (request.isIframeFallback) {
    const retries = iframeAutoRetries.get(videoId) ?? 0;
    const isRetriesExhausted = retries >= MAX_IFRAME_AUTO_RETRIES;
    if (isRetriesExhausted) {
      iframeAutoRetries.delete(videoId);
      log.warn("All download methods exhausted for", videoId);
      onExhausted({
        videoId,
        tabId
      });
      return;
    }

    iframeAutoRetries.set(videoId, retries + 1);
    log.warn("Iframe fallback failed, auto-retrying via fresh iframe (attempt", retries + 1, ") for", videoId);
  } else {
    log.warn("SABR+CDN failed, trying offscreen iframe fallback for", videoId);
  }

  await sendMessageToTab(MessageType.UpdateDownloadProgress, {
    videoId,
    progress: 0,
    progressType: ProgressType.Video
  }, tabId);

  await downloadViaWatchPage({
    data: {
      ...request,
      isIframeFallback: false
    },
    tabId
  });
}
