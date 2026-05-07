import { checkInterruptedDownload } from "../download/interrupted-downloads";
import {
  cancelStreamTransfer,
  handleStreamData,
  handleStreamError,
  uncancelStreamTransfer
} from "../download/stream-transfer";
import { handlePageChange } from "../ui/page-router";
import { mountPanelUi } from "../ui/panel-ui";
import { mountToastUi } from "../ui/toast-ui";
import { clearRemovedVideoId, registerProgressHandler } from "./progress-handler";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";
import { MessageType, sendMessage } from "@/lib/messaging/messaging";
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
    mountToastUi({ videoData: data.videoData });
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

  crossWorldMessenger.onMessage(CrossWorldMessage.StartBackgroundDownload, async ({ data }) => {
    console.log(`[ytdl:isolated-fwd] StartBackgroundDownload received videoId=${data.videoId}, forwarding to BG`);
    // Firefox MV3 event-page wakes the BG service worker on the first message
    // but webext-core/messaging doesn't retry if the receiver isn't yet
    // registered, so the very first send racing the BG startup gets dropped
    // with "Could not establish connection". Retry a few times with a small
    // backoff to bridge that window.
    const SEND_RETRY_DELAY_MS = 200;
    const MAX_SEND_RETRIES = 10;
    for (let attempt = 0; attempt < MAX_SEND_RETRIES; attempt++) {
      try {
        await sendMessage(MessageType.StartBackgroundDownload, data);
        console.log(`[ytdl:isolated-fwd] StartBackgroundDownload BG ack`);
        return;
      } catch (error) {
        if (attempt === MAX_SEND_RETRIES - 1) {
          console.log(`[ytdl:isolated-fwd] StartBackgroundDownload BG err: ${String(error)}`);
          return;
        }

        await new Promise(resolve => setTimeout(resolve, SEND_RETRY_DELAY_MS));
      }
    }
  });

  crossWorldMessenger.onMessage(CrossWorldMessage.IframePlayerReady, ({ data }) => {
    void sendMessage(MessageType.DownloadIframeReady, { videoId: data.videoId });
  });

  crossWorldMessenger.onMessage(CrossWorldMessage.DownloadRequest, ({ data }) => {
    uncancelStreamTransfer(data.videoId);
    clearRemovedVideoId(data.videoId);
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

  crossWorldMessenger.onMessage(
    CrossWorldMessage.RequestFreshSabrPrimer,
    async ({ data }) => {
      console.log(`[ytdl:isolated] RequestFreshSabrPrimer forwarding videoId=${data.videoId}`);
      const result = await sendMessage(MessageType.RequestFreshSabrPrimer, data).catch(() => null);
      console.log(`[ytdl:isolated] RequestFreshSabrPrimer result hasResult=${Boolean(result)}`);
      // Push result back via FreshSabrPrimerReady instead of returning it, because
      // youtube-main.content's crossWorldMessenger fires an empty response first and
      // the MAIN world resolves on that before this async handler completes.
      void crossWorldMessenger.sendMessage(CrossWorldMessage.FreshSabrPrimerReady, { result }).catch(() => {});
    }
  );

  registerProgressHandler();
}
