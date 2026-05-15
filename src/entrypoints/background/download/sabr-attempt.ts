import { downloadViaWatchPage } from "./iframe-downloader";
import { downloadViaSabr } from "./sabr-downloader";
import { MessageType, sendMessage } from "@/lib/messaging/messaging";
import { ProgressType } from "@/types";
import type { DownloadRequest, VideoTabParams } from "@/types";

const SABR_STALL_TIMEOUT_MS = 30_000;
const MAX_IFRAME_AUTO_RETRIES = 2;
const iframeAutoRetries = new Map<string, number>();

export function clearIframeAutoRetry(videoId: string) {
  iframeAutoRetries.delete(videoId);
}

export async function attemptSabrDownload({ request, signal, tabId }: {
  request: DownloadRequest;
  signal: AbortSignal;
  tabId: number;
}) {
  const sabrAbortController = new AbortController();
  let sabrStallTimeoutId = setTimeout(() => sabrAbortController.abort(), SABR_STALL_TIMEOUT_MS);
  signal.addEventListener("abort", () => sabrAbortController.abort(), { once: true });

  function resetSabrStallTimer() {
    clearTimeout(sabrStallTimeoutId);
    sabrStallTimeoutId = setTimeout(() => sabrAbortController.abort(), SABR_STALL_TIMEOUT_MS);
  }

  try {
    return await downloadViaSabr({
      request,
      signal: sabrAbortController.signal,
      tabId,
      onProgress: resetSabrStallTimer
    });
  } finally {
    clearTimeout(sabrStallTimeoutId);
  }
}

export async function handleIframeFallback({
  request, tabId, videoId, reportDownloadFailed
}: {
  request: DownloadRequest;
  tabId: number;
  videoId: string;
  reportDownloadFailed: (params: VideoTabParams) => void;
}) {
  if (request.isIframeFallback) {
    const retries = iframeAutoRetries.get(videoId) ?? 0;
    const hasExhaustedRetries = retries >= MAX_IFRAME_AUTO_RETRIES;
    if (hasExhaustedRetries) {
      iframeAutoRetries.delete(videoId);
      console.warn("[ytdl:bg] All download methods exhausted for", videoId);
      reportDownloadFailed({
        videoId,
        tabId
      });
      return;
    }

    iframeAutoRetries.set(videoId, retries + 1);
    console.warn("[ytdl:bg] Iframe fallback failed, auto-retrying via fresh iframe (attempt", retries + 1, ") for", videoId);
  } else {
    console.warn("[ytdl:bg] SABR+CDN failed, trying offscreen iframe fallback for", videoId);
  }

  void sendMessage(MessageType.UpdateDownloadProgress, {
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
