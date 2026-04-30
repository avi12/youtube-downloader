import { checkInterruptedDownload } from "../download/interrupted-downloads";
import {
  cancelStreamTransfer,
  handleStreamData,
  handleStreamError,
  uncancelStreamTransfer
} from "../download/stream-transfer";
import { handlePageChange } from "../ui/page-router";
import { mountPanelUi } from "../ui/panel-ui";
import { registerProgressHandler } from "./progress-handler";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";
import { MessageType, onMessage, sendMessage } from "@/lib/messaging/messaging";
import { downloadProgressStore } from "@/lib/ui/synced-stores.svelte";
import { forwardSabrCredentialsWithRetry } from "@/lib/youtube/sabr/credentials";

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
    mountPanelUi({
      context,
      contentId: data.contentId,
      videoData: data.videoData
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
    console.log(`[ytdl:isolated-fwd] StartBackgroundDownload received videoId=${data.videoId}, forwarding to BG`);
    void sendMessage(MessageType.StartBackgroundDownload, data).then(
      () => console.log(`[ytdl:isolated-fwd] StartBackgroundDownload BG ack`),
      err => console.log(`[ytdl:isolated-fwd] StartBackgroundDownload BG err: ${String(err)}`)
    );
  });

  crossWorldMessenger.onMessage(CrossWorldMessage.StartIframeScrub, ({ data }) => {
    void sendMessage(MessageType.StartIframeScrub, data);
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

  onMessage(MessageType.MountScrubIframeInTab, ({ data }) => {
    if (document.querySelector(`iframe[data-ytdl-scrub-iframe="${data.id}"]`)) {
      return;
    }

    const iframe = document.createElement("iframe");
    iframe.setAttribute("data-ytdl-scrub-iframe", data.id);
    iframe.src = data.url;
    iframe.setAttribute("allow", "autoplay; encrypted-media; clipboard-read");
    iframe.setAttribute("style", "width:480px;height:270px;border:0;position:fixed;left:-9999px;top:-9999px;visibility:hidden");
    document.body.append(iframe);
  });

  onMessage(MessageType.UnmountScrubIframeInTab, ({ data }) => {
    document.querySelector(`iframe[data-ytdl-scrub-iframe="${data.id}"]`)?.remove();
  });

  registerProgressHandler();
}
