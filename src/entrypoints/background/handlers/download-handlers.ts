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
import { clearCancelledVideo, isVideoCancelled } from "./pipeline-state";
import {
  abortCurrentSequence,
  clearCurrentSequenceTabId,
  getCurrentSequenceTabId,
  registerPlaylistDownloadHandler
} from "./playlist-download-handler";
import { registerProxyFetchHandler } from "./proxy-fetch-handler";
import { MessageType, onMessage, sendMessage, sendMessageToTab } from "@/lib/messaging/messaging";
import { OffscreenMessageType, sendToOffscreen } from "@/lib/messaging/offscreen-messaging";
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

    void downloadViaWatchPage({
      data,
      tabId: originTabId
    });
  });

  onMessage(MessageType.Keepalive, () => {});

  onMessage(MessageType.CancelDownload, async ({ data }) => {
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
      await dropPendingRetry(videoId);
      signalVideoComplete(videoId);
      const trackedTabIds = getTabIdsForVideo(videoId);
      for (const tabId of trackedTabIds) {
        await sendMessageToTab(MessageType.UpdateDownloadProgress, {
          videoId,
          ...progressRemoval
        }, tabId);
      }

      const isSequenceTabUntouched = sequenceTabId && !trackedTabIds.includes(sequenceTabId);
      if (isSequenceTabUntouched) {
        await sendMessageToTab(MessageType.UpdateDownloadProgress, {
          videoId,
          ...progressRemoval
        }, sequenceTabId);
      }
    }

    clearCurrentSequenceTabId();
    await removeFromPopupList(data.videoIds);
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

      await sendMessageToTab(MessageType.UpdateDownloadProgress, {
        videoId,
        progress: 0,
        progressType: ProgressType.Video,
        isRemoved: true
      }, tabId);

      await removeFromPopupList(videoId);
      signalVideoComplete(videoId);
    } catch (error) {
      console.warn("[ytdl:bg] Blob URL download failed:", error);
      void reportDownloadFailed({
        videoId,
        tabId
      });
    }
  });

  onMessage(MessageType.StartBackgroundDownload, async ({ data, sender }) => {
    let tabId: number | undefined = sender.tab?.id ?? getTabIdsForVideo(data.videoId)[0];
    const isTabIdMissing = !tabId;
    if (isTabIdMissing) {
      const [ytTab] = await browser.tabs.query({
        url: "*://*.youtube.com/*",
        active: true
      });
      tabId = ytTab?.id;
    }

    const resolvedTabId = tabId ?? -1;
    // A fresh download intent supersedes any prior cancel marker for this
    // video. Without this the BG would still treat post-cancel errors as
    // "user cancelled" even though this is a brand-new attempt.
    clearCancelledVideo(data.videoId);
    trackVideoForTab({
      videoId: data.videoId,
      tabId: resolvedTabId
    });
    const hasHeight = !!data.videoFormat?.height;
    await enqueueToPopupList({
      videoId: data.videoId,
      type: data.type,
      filenameOutput: data.filenameOutput,
      quality: hasHeight ? `${data.videoFormat!.height}p` : undefined,
      tabId: resolvedTabId
    });
    void startBackgroundDownload({
      request: data,
      tabId: resolvedTabId
    });

    await sendMessageToTab(MessageType.StartKeepalive, { videoId: data.videoId }, resolvedTabId);
  });

  onMessage(MessageType.RequestDirectUrlDownload, async ({ data }) => {
    const { videoId, tabId, request } = data;
    const downloadId = await tryDirectUrlDownload({ request });
    if (downloadId !== null) {
      clearIframeAutoRetry(videoId);

      await sendMessageToTab(MessageType.UpdateDownloadProgress, {
        videoId,
        progress: 0,
        progressType: ProgressType.Video,
        isRemoved: true
      }, tabId);

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

  onMessage(MessageType.ReportWorkerDownloadFailed, async ({ data }) => {
    const { videoId, tabId } = data;
    const isCancelAbort = isVideoCancelled(videoId);
    if (isCancelAbort) {
      return;
    }

    await reportDownloadFailed({
      videoId,
      tabId
    });
  });

  onMessage(MessageType.ForwardProgressUpdate, async ({ data }) => {
    const { tabId, ...progressData } = data;
    await sendMessageToTab(MessageType.UpdateDownloadProgress, progressData, tabId);
  });
}
