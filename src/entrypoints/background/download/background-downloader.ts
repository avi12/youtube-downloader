import { removeFromPopupList } from "../queue/popup-list";
import { signalVideoComplete } from "../queue/sequential-queue";
import { downloadViaCdn } from "./cdn-downloader";
import {
  clearInterruptedDownload,
  dropPendingRetry,
  queueNetworkRetry,
  registerOnlineRetryListener
} from "./network-retry";
import { attemptSabrDownload, clearIframeAutoRetry, handleIframeFallback } from "./sabr-attempt";
import { dispatchToOffscreen } from "./stream-dispatch";
import { MessageType, sendMessage } from "@/lib/messaging/messaging";
import { fetchYouTubeMusicMetadata } from "@/lib/youtube/youtube-music-metadata";
import { ProgressType } from "@/types";
import type { DownloadRequest, VideoMetadata, VideoTabParams } from "@/types";

export type { DownloadResult } from "./download-result-types";

const activeBackgroundDownloads = new Map<string, AbortController>();

export { dropPendingRetry };

registerOnlineRetryListener(startBackgroundDownload);

export function reportDownloadFailed({ videoId, tabId }: VideoTabParams) {
  void sendMessage(MessageType.UpdateDownloadProgress, {
    videoId,
    progress: 0,
    progressType: ProgressType.Video,
    isRemoved: true,
    isFailed: true
  }, tabId);
  void removeFromPopupList(videoId);
  signalVideoComplete(videoId);
}

export function cancelBackgroundDownload(videoId: string) {
  const controller = activeBackgroundDownloads.get(videoId);
  if (!controller) {
    return;
  }

  controller.abort();
  activeBackgroundDownloads.delete(videoId);
  clearIframeAutoRetry(videoId);
}

async function enrichMetadataFromYouTubeMusic(metadata: VideoMetadata | null | undefined) {
  if (!metadata?.isMusic) {
    return metadata;
  }

  const searchQuery = `${metadata.artist} ${metadata.title}`.trim();
  if (!searchQuery) {
    return metadata;
  }

  return fetchYouTubeMusicMetadata({
    searchQuery,
    existingMetadata: metadata
  });
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

    let result = await attemptSabrDownload({
      request,
      signal,
      tabId
    }).catch(sabrError => {
      if (signal.aborted) {
        throw sabrError;
      }

      console.warn("[ytdl:bg] SABR failed, trying CDN:", sabrError);
      void sendMessage(MessageType.UpdateDownloadProgress, {
        videoId,
        progress: 0,
        progressType: ProgressType.Video
      }, tabId);
      return null;
    });
    if (signal.aborted) {
      return;
    }

    const needsCdn = !result?.audioData || result.isPartialVideo || result.isPartialAudio;
    const hasCdnUrls = !!(request.resolvedVideoUrl || request.resolvedAudioUrl);
    if (needsCdn && hasCdnUrls) {
      result = await downloadViaCdn({
        request,
        signal,
        videoId,
        tabId,
        partialVideoData: result?.isPartialVideo ? (result.videoData ?? undefined) : undefined,
        partialAudioData: result?.isPartialAudio ? (result.audioData ?? undefined) : undefined
      }).catch(cdnError => {
        if (signal.aborted) {
          throw cdnError;
        }

        console.warn("[ytdl:bg] CDN failed, trying iframe fallback:", cdnError);
        return null;
      });
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
