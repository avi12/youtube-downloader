import { cancelStreamTransfer, uncancelStreamTransfer } from "../download/stream-transfer";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";
import { MessageType, sendMessage } from "@/lib/messaging/messaging";
import { statusProgressItem } from "@/lib/storage/storage";
import { downloadProgressStore, interruptedDownloadStore } from "@/lib/ui/synced-stores.svelte";
import type { DownloadRequest } from "@/types";

const INITIAL_DOWNLOAD_PROGRESS = {
  isDownloading: true,
  isDone: false,
  progress: 0,
  progressType: ""
} as const;

export function registerDownloadProgressHandlers() {
  crossWorldMessenger.onMessage(CrossWorldMessage.CancelDownload, async ({ data }) => {
    for (const id of data.videoIds) {
      downloadProgressStore.delete(id);
      interruptedDownloadStore.delete(id);
      cancelStreamTransfer(id);
    }

    void sendMessage(MessageType.CancelDownload, { videoIds: data.videoIds });
    const currentProgress = await statusProgressItem.getValue();
    for (const id of data.videoIds) {
      const isNotDownloading = !downloadProgressStore.get(id)?.isDownloading;
      if (isNotDownloading) {
        delete currentProgress[id];
      }
    }

    await statusProgressItem.setValue(currentProgress);
  });

  crossWorldMessenger.onMessage(CrossWorldMessage.StartBackgroundDownload, ({ data }) => {
    const request: DownloadRequest = JSON.parse(data.requestJson);
    const isProgressSlotAvailable = downloadProgressStore.setLocal(request.videoId, INITIAL_DOWNLOAD_PROGRESS);
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
    downloadProgressStore.unsuppress(data.videoId);
    downloadProgressStore.setLocal(data.videoId, {
      isDownloading: true,
      isDone: false,
      progress: 0,
      progressType: ""
    });
    uncancelStreamTransfer(data.videoId);
  });

  crossWorldMessenger.onMessage(CrossWorldMessage.DownloadProgress, ({ data }) => {
    downloadProgressStore.setLocal(data.videoId, {
      isDownloading: true,
      isDone: false,
      progress: data.progress,
      progressType: data.progressType
    });
  });

  crossWorldMessenger.onMessage(CrossWorldMessage.DownloadBlobUrl, ({ data }) => {
    void sendMessage(MessageType.DownloadBlobUrl, data);
  });

  crossWorldMessenger.onMessage(CrossWorldMessage.ReportPageProgress, ({ data }) => {
    downloadProgressStore.unsuppress(data.videoId);
    downloadProgressStore.setLocal(data.videoId, {
      isDownloading: true,
      isDone: false,
      progress: data.progress,
      progressType: data.progressType
    });
    void sendMessage(MessageType.ReportPageProgress, data);
  });
}
