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
import { downloadProgressStore } from "@/lib/ui/synced-stores.svelte";
import { forwardSabrCredentialsWithRetry } from "@/lib/youtube/sabr/credentials";
import type { DownloadRequest, VideoData } from "@/types";

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

  crossWorldMessenger.onMessage(CrossWorldMessage.CancelRequest, ({ data }) => {
    for (const id of data.videoIds) {
      cancelStreamTransfer(id);
    }

    void sendMessage(MessageType.CancelDownload, { videoIds: data.videoIds });
    void crossWorldMessenger.sendMessage(CrossWorldMessage.CancelDownload, { videoIds: data.videoIds });
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
    downloadProgressStore.setLocal(request.videoId, {
      isDownloading: true,
      isDone: false,
      progress: 0,
      progressType: ""
    });
    void sendMessage(MessageType.StartBackgroundDownload, request);
  });

  crossWorldMessenger.onMessage(CrossWorldMessage.IframePlayerReady, ({ data }) => {
    void sendMessage(MessageType.DownloadIframeReady, { videoId: data.videoId });
  });

  crossWorldMessenger.onMessage(CrossWorldMessage.DownloadRequest, ({ data }) => {
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
