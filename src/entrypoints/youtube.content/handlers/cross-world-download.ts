import { cancelStreamTransfer, uncancelStreamTransfer } from "../download/stream-transfer";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";
import { MessageType, sendMessage } from "@/lib/messaging/messaging";
import { performCancelDownload } from "@/lib/ui/cancel-download";
import { downloadProgressStore } from "@/lib/ui/synced-stores.svelte";
import type { DownloadRequest } from "@/types";

const INITIAL_DOWNLOAD_PROGRESS = {
  isDownloading: true,
  isDone: false,
  progress: 0,
  progressType: ""
} as const;

export function registerDownloadProgressHandlers() {
  crossWorldMessenger.onMessage(CrossWorldMessage.CancelDownload, ({ data }) => {
    for (const id of data.videoIds) {
      cancelStreamTransfer(id);
    }

    void performCancelDownload(data.videoIds);
  });

  crossWorldMessenger.onMessage(CrossWorldMessage.StartBackgroundDownload, ({ data }) => {
    const request: DownloadRequest = JSON.parse(data.requestJson);
    const isProgressSlotAvailable = downloadProgressStore.setLocal(request.videoId, {
      ...INITIAL_DOWNLOAD_PROGRESS,
      videoItag: request.videoItag,
      audioItag: request.audioItag,
      downloadType: request.type
    });
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
      progressType: "",
      videoItag: data.videoItag,
      audioItag: data.audioItag,
      downloadType: data.type
    });
    uncancelStreamTransfer(data.videoId);
  });

  crossWorldMessenger.onMessage(CrossWorldMessage.DownloadProgress, ({ data }) => {
    downloadProgressStore.unsuppress(data.videoId);
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
