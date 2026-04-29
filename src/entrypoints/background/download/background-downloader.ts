import { startIframeScrubSession } from "../handlers/iframe-scrub-orchestrator";
import { removeFromPopupList } from "../queue/popup-list";
import { signalVideoComplete } from "../queue/sequential-queue";
import { enrichWithAlternateClientUrls } from "./alternate-client-enricher";
import { downloadViaCdn } from "./cdn-downloader";
import { clearInterruptedDownload, persistInterruptedDownload, reportDownloadFailed } from "./download-retry";
import { dispatchToOffscreen, enrichMetadataFromYouTubeMusic } from "./offscreen-dispatcher";
import { downloadViaSabr } from "./sabr-downloader";
import { broadcastDebugLogToTab } from "@/lib/messaging/debug-log";
import { MessageType, sendMessage } from "@/lib/messaging/messaging";
import { ProgressType } from "@/types";
import type { DownloadRequest } from "@/types";

export { removeFromPopupList, signalVideoComplete };

const FIREFOX_IFRAME_SCRUB_FALLBACK_MIN_DURATION_SEC = 240;
const SABR_STALL_TIMEOUT_MS = 30_000;

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
const pendingNetworkRetries = new Map<string, {
  request: DownloadRequest;
  tabId: number;
}>();

addEventListener("online", () => {
  const retries = [...pendingNetworkRetries.values()];
  pendingNetworkRetries.clear();
  for (const { request, tabId } of retries) {
    void startBackgroundDownload({
      request,
      tabId
    });
  }
});

export function cancelBackgroundDownload(videoId: string) {
  const controller = activeBackgroundDownloads.get(videoId);
  if (!controller) {
    return;
  }

  controller.abort();
  activeBackgroundDownloads.delete(videoId);
}

async function attemptSabrDownload({ request, signal, tabId }: {
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

async function tryIframeScrubFallback({ request, cdnRequest, videoId, tabId }: {
  request: DownloadRequest;
  cdnRequest: DownloadRequest;
  videoId: string;
  tabId: number;
}) {
  const durationSec = request.videoDurationSec ?? 0;
  if (!import.meta.env.FIREFOX || durationSec < FIREFOX_IFRAME_SCRUB_FALLBACK_MIN_DURATION_SEC) {
    return false;
  }

  broadcastDebugLogToTab(`[ytdl:bg] CDN unavailable; using iframe-scrub for ${videoId} (${durationSec}s)`, tabId);
  await startIframeScrubSession({
    videoId,
    durationSec,
    type: request.type,
    filenameOutput: request.filenameOutput,
    videoMimeType: request.videoFormat?.mimeType?.split(";")[0] || "video/mp4",
    audioMimeType: request.audioFormat?.mimeType?.split(";")[0] || "audio/mp4",
    audioLabel: request.primaryAudioLabel ?? "",
    metadata: request.metadata,
    playlistId: request.playlistId,
    playlistTitle: request.playlistTitle,
    playlistTotalCount: request.playlistTotalCount,
    additionalAudioFormats: cdnRequest.additionalAudioFormats,
    resolvedExtraAudioUrls: cdnRequest.resolvedExtraAudioUrls,
    captionTracks: cdnRequest.captionTracks,
    tabId
  });
  return true;
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

    let result: DownloadResult | null = null;
    const cdnRequest = await enrichWithAlternateClientUrls(request, tabId);
    const haveCdnUrls = Boolean(cdnRequest.resolvedVideoUrl || cdnRequest.resolvedAudioUrl);
    broadcastDebugLogToTab(
      `[ytdl:bg] CDN-first check: haveUrls=${haveCdnUrls} video=${Boolean(cdnRequest.resolvedVideoUrl)} audio=${Boolean(cdnRequest.resolvedAudioUrl)}`,
      tabId
    );

    if (haveCdnUrls) {
      result = await downloadViaCdn({
        request: cdnRequest,
        signal,
        videoId,
        tabId
      }).catch(error => {
        if (signal.aborted) {
          throw error;
        }

        console.warn("[ytdl:bg] CDN-first failed:", error);
        broadcastDebugLogToTab(`[ytdl:bg] CDN-first threw: ${String(error)}`, tabId);
        return null;
      });
      broadcastDebugLogToTab(
        `[ytdl:bg] CDN-first done: video=${result?.videoData?.byteLength ?? 0}B audio=${result?.audioData?.byteLength ?? 0}B`,
        tabId
      );
    }

    if (!result?.audioData && !result?.videoData) {
      const usedFallback = await tryIframeScrubFallback({
        request,
        cdnRequest,
        videoId,
        tabId
      });
      if (usedFallback) {
        return;
      }
    }

    if (!result?.audioData) {
      result = await attemptSabrDownload({
        request,
        signal,
        tabId
      }).catch(sabrError => {
        if (signal.aborted) {
          throw sabrError;
        }

        console.warn("[ytdl:bg] direct SABR failed:", sabrError);
        void sendMessage(MessageType.UpdateDownloadProgress, {
          videoId,
          progress: 0,
          progressType: ProgressType.Video
        }, tabId);
        return null;
      });
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
      pendingNetworkRetries.set(videoId, {
        request,
        tabId
      });
      void persistInterruptedDownload(request);
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
