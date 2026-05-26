import { cancelDownloadsLocally, markDownloadStartingLocally } from "../download/cancel-actions";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";
import { MessageType, sendMessage } from "@/lib/messaging/messaging";
import { downloadProgressStore } from "@/lib/ui/synced-stores.svelte";
import type { DownloadProgressEntry, DownloadRequest } from "@/types";

const INITIAL_DOWNLOAD_PROGRESS: DownloadProgressEntry = {
  isDownloading: true,
  isDone: false,
  progress: 0,
  progressType: ""
};

export function registerDownloadProgressHandlers() {
  crossWorldMessenger.onMessage(CrossWorldMessage.CancelDownload, ({ data }) => {
    void cancelDownloadsLocally(data.videoIds);
  });

  crossWorldMessenger.onMessage(CrossWorldMessage.StartBackgroundDownload, ({ data }) => {
    const request: DownloadRequest = JSON.parse(data.requestJson);
    const isProgressSlotAvailable = downloadProgressStore.set(request.videoId, INITIAL_DOWNLOAD_PROGRESS);
    if (!isProgressSlotAvailable) {
      return;
    }

    void sendMessage(MessageType.StartBackgroundDownload, request);
  });

  crossWorldMessenger.onMessage(CrossWorldMessage.IframePlayerReady, async ({ data }) => {
    const request = await sendMessage(MessageType.DownloadIframeReady, { videoId: data.videoId });
    if (request) {
      void crossWorldMessenger.sendMessage(CrossWorldMessage.DownloadRequest, request);
    }
  });

  crossWorldMessenger.onMessage(CrossWorldMessage.DownloadRequest, ({ data }) => {
    markDownloadStartingLocally(data.videoId);
  });

  crossWorldMessenger.onMessage(CrossWorldMessage.DownloadProgress, ({ data }) => {
    downloadProgressStore.unsuppress(data.videoId);
    downloadProgressStore.set(data.videoId, {
      isDownloading: true,
      isDone: false,
      progress: data.progress,
      progressType: data.progressType
    });
  });

  crossWorldMessenger.onMessage(CrossWorldMessage.DownloadBlobUrl, ({ data }) => {
    void sendMessage(MessageType.DownloadBlobUrl, data);
  });
}
