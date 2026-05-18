import {
  cancelBackgroundDownload,
  dropPendingRetry,
  reportDownloadFailed,
  startBackgroundDownload
} from "../download/background-downloader";
import { downloadViaWatchPage, initIframeReadyListener } from "../download/iframe-downloader";
import { clearIframeAutoRetry } from "../download/sabr-attempt";
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
      await sendMessage(MessageType.UpdateDownloadProgress, {
        videoId,
        progress: 0,
        progressType: ProgressType.Video,
        isRemoved: true
      }, tabId);
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
    const tabId = sender.tab?.id ?? getTabIdsForVideo(data.videoId)[0] ?? -1;
    trackVideoForTab({
      videoId: data.videoId,
      tabId
    });
    await enqueueToPopupList({
      videoId: data.videoId,
      type: data.type,
      filenameOutput: data.filenameOutput,
      quality: data.videoFormat?.height ? `${data.videoFormat.height}p` : undefined,
      tabId
    });
    void startBackgroundDownload({
      request: data,
      tabId
    });
    await sendMessage(MessageType.StartKeepalive, { videoId: data.videoId }, tabId);
  });
}
