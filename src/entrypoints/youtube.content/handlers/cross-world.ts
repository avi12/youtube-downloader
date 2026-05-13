import { checkInterruptedDownload } from "../download/interrupted-downloads";
import {
  cancelStreamTransfer,
  handleStreamData,
  handleStreamError,
  uncancelStreamTransfer
} from "../download/stream-transfer";
import { handlePageChange } from "../ui/page-router";
import { mountPanelUi } from "../ui/panel-ui";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";
import { MessageType, sendMessage } from "@/lib/messaging/messaging";
import { statusProgressItem } from "@/lib/storage/storage";
import { downloadProgressStore, interruptedDownloadStore } from "@/lib/ui/synced-stores.svelte";
import { forwardSabrCredentialsWithRetry } from "@/lib/youtube/sabr/credentials";
import type { DownloadRequest, VideoData } from "@/types";

const INITIAL_DOWNLOAD_PROGRESS = {
  isDownloading: true,
  isDone: false,
  progress: 0,
  progressType: ""
} as const;

export function registerCrossWorldHandlers(
  isDownloadIframe: boolean,
  context: InstanceType<typeof ContentScriptContext>
) {
  crossWorldMessenger.onMessage(CrossWorldMessage.VideoData, async ({ data }) => {
    await checkInterruptedDownload(data.videoId);
  });

  crossWorldMessenger.onMessage(CrossWorldMessage.Navigation, ({ data }) => {
    if (!isDownloadIframe) {
      handlePageChange({
        url: data.url,
        context
      });
    }

    void forwardSabrCredentialsWithRetry();
  });

  crossWorldMessenger.onMessage(CrossWorldMessage.PanelContentReady, ({ data }) => {
    const videoData: VideoData = JSON.parse(data.videoDataJson);
    mountPanelUi({
      context,
      contentId: data.contentId,
      videoData
    });
  });

  crossWorldMessenger.onMessage(CrossWorldMessage.CancelDownload, async ({ data }) => {
    for (const id of data.videoIds) {
      downloadProgressStore.delete(id);
      interruptedDownloadStore.delete(id);
      cancelStreamTransfer(id);
    }

    void sendMessage(MessageType.CancelDownload, { videoIds: data.videoIds });
    const currentProgress = await statusProgressItem.getValue();
    for (const id of data.videoIds) {
      if (!downloadProgressStore.get(id)?.isDownloading) {
        delete currentProgress[id];
      }
    }

    await statusProgressItem.setValue(currentProgress);
  });

  crossWorldMessenger.onMessage(CrossWorldMessage.StreamData, ({ data }) => {
    void handleStreamData(data);
  });

  crossWorldMessenger.onMessage(CrossWorldMessage.StreamError, ({ data }) => {
    handleStreamError(data);
  });

  crossWorldMessenger.onMessage(CrossWorldMessage.DownloadViaIframe, ({ data }) => {
    void sendMessage(MessageType.DownloadViaWatchPage, data);
  });

  crossWorldMessenger.onMessage(CrossWorldMessage.StartBackgroundDownload, ({ data }) => {
    const request: DownloadRequest = JSON.parse(data.requestJson);
    downloadProgressStore.setLocal(request.videoId, INITIAL_DOWNLOAD_PROGRESS);
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

  crossWorldMessenger.onMessage(
    CrossWorldMessage.ProxyFetch,
    ({ data }) => sendMessage(MessageType.BackgroundProxyFetch, data)
  );
}
