import {
  cancelBackgroundDownload,
  dropPendingRetry,
  reportDownloadFailed,
  startBackgroundDownload
} from "../download/background-downloader";
import { tryDirectUrlDownload } from "../download/download-fallback-chain";
import { downloadViaWatchPage, initIframeReadyListener } from "../download/iframe-downloader";
import { clearIframeAutoRetry, handleIframeFallback } from "../download/sabr-attempt";
import { enqueueToPopupList, removeFromPopupList } from "../queue/popup-list";
import { signalVideoComplete } from "../queue/sequential-queue";
import { cancelDownloads, getTabIdsForVideo, trackVideoForTab } from "../queue/tab-tracker";
import { markVideosCancelled } from "./pipeline-handlers";
import {
  abortCurrentSequence,
  clearCurrentSequenceTabId,
  getCurrentSequenceTabId,
  registerPlaylistDownloadHandler
} from "./playlist-download-handler";
import { registerProxyFetchHandler } from "./proxy-fetch-handler";
import { MessageType, onMessage, sendMessage } from "@/lib/messaging/messaging";
import { OffscreenMessageType, sendToOffscreen } from "@/lib/messaging/offscreen-messaging";
import { mutateStorageItem, statusProgressItem } from "@/lib/storage/storage";
import { resolveQualityLabel } from "@/lib/youtube/audio-format-helpers";
import { ProgressType } from "@/types";

export function registerDownloadHandlers() {
  initIframeReadyListener();
  registerProxyFetchHandler();
  registerPlaylistDownloadHandler();

  onMessage(MessageType.DownloadViaWatchPage, ({ data, sender }) => {
    const originTabId = sender.tab?.id;
    if (!originTabId) {
      return;
    }

    const sourceUrl = data.sourceUrl ?? sender.tab?.url;
    void downloadViaWatchPage({
      data: sourceUrl ? {
        ...data,
        sourceUrl
      } : data,
      tabId: originTabId
    });
  });

  onMessage(MessageType.Keepalive, () => {});

  onMessage(MessageType.CancelDownload, ({ data }) => {
    abortCurrentSequence();
    markVideosCancelled(data.videoIds);

    const progressRemoval = {
      progress: 0,
      progressType: ProgressType.Video,
      isRemoved: true
    } as const;

    sendToOffscreen({
      type: OffscreenMessageType.CancelProcessing,
      data: {
        videoIds: data.videoIds
      }
    });

    const sequenceTabId = getCurrentSequenceTabId();
    for (const videoId of data.videoIds) {
      cancelBackgroundDownload(videoId);
      dropPendingRetry(videoId);
      signalVideoComplete(videoId);
      const trackedTabIds = getTabIdsForVideo(videoId);
      for (const tabId of trackedTabIds) {
        void sendMessage(MessageType.UpdateDownloadProgress, {
          videoId,
          ...progressRemoval
        }, tabId);
      }

      const isSequenceTabUntouched = sequenceTabId && !trackedTabIds.includes(sequenceTabId);
      if (isSequenceTabUntouched) {
        void sendMessage(MessageType.UpdateDownloadProgress, {
          videoId,
          ...progressRemoval
        }, sequenceTabId);
      }
    }

    clearCurrentSequenceTabId();
    void removeFromPopupList(data.videoIds);
    void cancelDownloads(data.videoIds);
  });

  onMessage(MessageType.DownloadBlobUrl, async ({ data }) => {
    const { blobUrl, filename, videoId } = data;
    const tabId = getTabIdsForVideo(videoId)[0] ?? -1;
    try {
      await browser.downloads.download({
        url: blobUrl,
        filename
      });
      clearIframeAutoRetry(videoId);

      if (tabId >= 0) {
        await sendMessage(MessageType.UpdateDownloadProgress, {
          videoId,
          progress: 0,
          progressType: ProgressType.Video,
          isRemoved: true
        }, tabId);
      }

      await removeFromPopupList(videoId);
      signalVideoComplete(videoId);
    } catch (error) {
      console.warn("[ytdl:bg] Blob URL download failed:", error);
      reportDownloadFailed({
        videoId,
        tabId
      });
    }
  });

  onMessage(MessageType.StartBackgroundDownload, async ({ data, sender }) => {
    let tabId = data.originTabId ?? sender.tab?.id ?? getTabIdsForVideo(data.videoId)[0];
    const isTabIdMissing = !tabId;
    if (isTabIdMissing) {
      const [ytTab] = await browser.tabs.query({
        url: "*://*.youtube.com/*",
        active: true
      });
      tabId = ytTab?.id;
    }

    const resolvedTabId = tabId ?? -1;
    const sourceUrl = data.sourceUrl ?? sender.tab?.url;
    const enrichedRequest = sourceUrl ? {
      ...data,
      sourceUrl
    } : data;
    trackVideoForTab({
      videoId: data.videoId,
      tabId: resolvedTabId
    });
    await enqueueToPopupList({
      videoId: data.videoId,
      type: data.type,
      filenameOutput: data.filenameOutput,
      quality: resolveQualityLabel(data),
      tabId: resolvedTabId,
      sourceUrl
    });
    void startBackgroundDownload({
      request: enrichedRequest,
      tabId: resolvedTabId
    });

    if (resolvedTabId >= 0) {
      await sendMessage(MessageType.StartKeepalive, { videoId: data.videoId }, resolvedTabId);
    }
  });

  onMessage(MessageType.RequestDirectUrlDownload, async ({ data }) => {
    const { videoId, tabId, request } = data;
    const downloadId = await tryDirectUrlDownload({ request });
    if (downloadId !== null) {
      clearIframeAutoRetry(videoId);

      if (tabId >= 0) {
        await sendMessage(MessageType.UpdateDownloadProgress, {
          videoId,
          progress: 0,
          progressType: ProgressType.Video,
          isRemoved: true
        }, tabId);
      }

      await removeFromPopupList(videoId);
      signalVideoComplete(videoId);
      return;
    }

    void sendMessage(MessageType.RequestWatchPageFallback, {
      videoId,
      tabId,
      request
    });
  });

  onMessage(MessageType.RequestWatchPageFallback, ({ data }) => {
    const { videoId, tabId, request } = data;
    void handleIframeFallback({
      request,
      tabId,
      videoId,
      reportDownloadFailed
    });
  });

  onMessage(MessageType.WorkerDownloadComplete, async ({ data }) => {
    const { videoId } = data;
    clearIframeAutoRetry(videoId);
  });

  onMessage(MessageType.ReportWorkerDownloadFailed, ({ data }) => {
    const { videoId, tabId } = data;
    reportDownloadFailed({
      videoId,
      tabId
    });
  });

  onMessage(MessageType.ForwardProgressUpdate, ({ data }) => {
    const { tabId, ...progressData } = data;
    void mutateStorageItem({
      item: statusProgressItem,
      mutator(current) {
        current[progressData.videoId] = {
          progress: progressData.progress,
          progressType: progressData.progressType
        };
      }
    });

    if (tabId >= 0) {
      void sendMessage(MessageType.UpdateDownloadProgress, progressData, tabId);
    }
  });

  onMessage(MessageType.ReportPageProgress, async ({ data, sender }) => {
    const tabId = sender.tab?.id ?? getTabIdsForVideo(data.videoId)[0] ?? -1;
    await mutateStorageItem({
      item: statusProgressItem,
      mutator(current) {
        current[data.videoId] = {
          progress: data.progress,
          progressType: data.progressType
        };
      }
    });

    if (tabId >= 0) {
      await sendMessage(MessageType.UpdateDownloadProgress, {
        videoId: data.videoId,
        progress: data.progress,
        progressType: data.progressType
      }, tabId);
    }
  });
}
