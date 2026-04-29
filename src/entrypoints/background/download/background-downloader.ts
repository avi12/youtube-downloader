import { enrichWithAlternateClientUrls } from "./alternate-client-enricher";
import { resolveDownloadResult } from "./download-resolver";
import { clearInterruptedDownload, reportDownloadFailed } from "./download-retry";
import { enqueueNetworkRetry, registerNetworkRetryCallback } from "./network-retry";
import { dispatchToOffscreen, enrichMetadataFromYouTubeMusic } from "./offscreen-dispatcher";
import { broadcastDebugLogToTab } from "@/lib/messaging/debug-log";
import type { DownloadRequest } from "@/types";

export interface DownloadResult {
  videoData: Uint8Array | null;
  audioData: Uint8Array | null;
  additionalAudioTracks: Array<{
    data: Uint8Array | null;
    mimeType: string;
    label: string;
  }>;
}

const activeBackgroundDownloads = new Map<string, AbortController>();

registerNetworkRetryCallback(({ request, tabId }) => {
  void startBackgroundDownload({
    request,
    tabId
  });
});

export function cancelBackgroundDownload(videoId: string) {
  const controller = activeBackgroundDownloads.get(videoId);
  if (!controller) {
    return;
  }

  controller.abort();
  activeBackgroundDownloads.delete(videoId);
}

export async function startBackgroundDownload({ request, tabId }: {
  request: DownloadRequest;
  tabId: number;
}) {
  const { videoId, metadata } = request;
  broadcastDebugLogToTab(
    `[ytdl:bg] startBackgroundDownload entry videoId=${videoId} tabId=${tabId} hasVideoFmt=${Boolean(request.videoFormat)} hasAudioFmt=${Boolean(request.audioFormat)} hasResolvedVideo=${Boolean(request.resolvedVideoUrl)} hasResolvedAudio=${Boolean(request.resolvedAudioUrl)}`,
    tabId
  );
  cancelBackgroundDownload(videoId);
  const abortController = new AbortController();
  activeBackgroundDownloads.set(videoId, abortController);
  const { signal } = abortController;

  try {
    const enrichedMetadataPromise = enrichMetadataFromYouTubeMusic(metadata);
    const cdnRequest = await enrichWithAlternateClientUrls(request, tabId);
    const result = await resolveDownloadResult({
      request,
      cdnRequest,
      signal,
      videoId,
      tabId
    });
    if (result === "iframe-scrub") {
      return;
    }

    if (!result?.audioData && !result?.videoData) {
      console.warn("[ytdl:bg] No download method succeeded for", videoId);
      reportDownloadFailed({
        videoId,
        tabId
      });
      return;
    }

    const enrichedMetadata = await enrichedMetadataPromise;
    await dispatchToOffscreen({
      request,
      result,
      enrichedMetadata,
      tabId
    });
    void clearInterruptedDownload(videoId);
  } catch (error) {
    if (signal.aborted) {
      return;
    }

    if (!navigator.onLine) {
      enqueueNetworkRetry({
        request,
        tabId
      });
      return;
    }

    broadcastDebugLogToTab(`[ytdl:bg] Background download failed: ${String(error)}`, tabId);
    console.warn("[ytdl:bg] Background download failed:", error);
    reportDownloadFailed({
      videoId,
      tabId
    });
  } finally {
    activeBackgroundDownloads.delete(videoId);
  }
}
