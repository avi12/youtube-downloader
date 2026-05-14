import { reportDownloadFailed } from "./download-failure-reporter";
import { trySabr, tryCdn } from "./download-fallback-chain";
import { enrichMetadataFromYouTubeMusic } from "./metadata-enrichment";
import {
  clearInterruptedDownload,
  dropPendingRetry,
  queueNetworkRetry,
  registerOnlineRetryListener
} from "./network-retry";
import { clearIframeAutoRetry, handleIframeFallback } from "./sabr-attempt";
import { dispatchToOffscreen } from "./stream-dispatch";
import type { DownloadRequest } from "@/types";

export type { DownloadResult } from "./download-result-types";
export { dropPendingRetry, reportDownloadFailed };

const activeBackgroundDownloads = new Map<string, AbortController>();

registerOnlineRetryListener(startBackgroundDownload);

export function cancelBackgroundDownload(videoId: string) {
  const controller = activeBackgroundDownloads.get(videoId);
  if (!controller) {
    return;
  }

  controller.abort();
  activeBackgroundDownloads.delete(videoId);
  clearIframeAutoRetry(videoId);
}

export async function startBackgroundDownload({ request, tabId }: {
  request: DownloadRequest;
  tabId: number;
}) {
  const { videoId, metadata } = request;
  cancelBackgroundDownload(videoId);
  const abortController = new AbortController();
  activeBackgroundDownloads.set(videoId, abortController);
  const { signal } = abortController;

  try {
    const enrichedMetadataPromise = enrichMetadataFromYouTubeMusic(metadata);
    let result = await trySabr(request, signal, tabId);
    if (signal.aborted) {
      return;
    }

    const needsCdn = !result?.audioData || result.isPartialVideo || result.isPartialAudio;
    const hasCdnUrls = !!(request.resolvedVideoUrl || request.resolvedAudioUrl);
    if (needsCdn && hasCdnUrls) {
      const partialVideoData = result?.isPartialVideo ? (result.videoData ?? undefined) : undefined;
      const partialAudioData = result?.isPartialAudio ? (result.audioData ?? undefined) : undefined;
      result = await tryCdn(request, signal, videoId, tabId, partialVideoData, partialAudioData);
    }

    if (signal.aborted) {
      return;
    }

    if (!(result?.videoData?.byteLength) && !(result?.audioData?.byteLength)) {
      await handleIframeFallback({
        request,
        tabId,
        videoId,
        reportDownloadFailed
      });
      return;
    }

    clearIframeAutoRetry(videoId);
    await dispatchToOffscreen({
      request,
      result,
      enrichedMetadata: await enrichedMetadataPromise,
      tabId
    });
    void clearInterruptedDownload(videoId);
  } catch (error) {
    if (signal.aborted) {
      return;
    }

    if (!navigator.onLine) {
      await queueNetworkRetry({
        request,
        tabId
      });
      return;
    }

    console.warn("[ytdl:bg] Background download failed:", error);
    reportDownloadFailed({
      videoId,
      tabId
    });
  } finally {
    activeBackgroundDownloads.delete(videoId);
  }
}
