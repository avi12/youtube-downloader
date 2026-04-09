import { listenForDownloadIframes } from "./download-iframe";
import { checkInterruptedDownload, listenForInterruptedDownloadEvents } from "./interrupted-downloads";
import { listenForKeepalive } from "./keepalive";
import { handlePageChange, setNativeDownloadVisibility } from "./page-router";
import { mountPanelUi } from "./panel-ui";
import {
  cancelStreamTransfer,
  handleStreamData,
  handleStreamError,
  setPlaylistContext,
  uncancelStreamTransfer
} from "./stream-transfer";
import "./style.css";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/cross-world-messenger";
import { MessageType, onMessage, sendMessage } from "@/lib/messaging";
import { forwardSabrCredentialsWithRetry, listenForSabrBodyReady } from "@/lib/sabr-credentials";
import { optionsItem } from "@/lib/storage";
import { downloadProgressStore } from "@/lib/synced-stores.svelte";
import { type Options } from "@/types";

export default defineContentScript({
  matches: ["https://www.youtube.com/*"],
  allFrames: true,
  async main(context) {
    const isDownloadIframe = self !== top && location.search.includes("ytdl=1");
    if (self !== top && !isDownloadIframe) {
      return;
    }

    let currentOptions: Options = await optionsItem.getValue();

    crossWorldMessenger.onMessage(CrossWorldMessage.VideoData, async ({ data }) => {
      await checkInterruptedDownload(data.videoId);
    });

    crossWorldMessenger.onMessage(CrossWorldMessage.Navigation, ({ data }) => {
      if (!isDownloadIframe) {
        handlePageChange(data.url, context, currentOptions);
      }

      void forwardSabrCredentialsWithRetry();
    });

    crossWorldMessenger.onMessage(CrossWorldMessage.PanelContentReady, ({ data }) => {
      mountPanelUi({
        context,
        contentId: data.contentId,
        videoData: data.videoData,
        options: currentOptions
      });
    });

    crossWorldMessenger.onMessage(CrossWorldMessage.CancelRequest, ({ data }) => {
      const { videoIds } = data;

      for (const id of videoIds) {
        cancelStreamTransfer(id);
      }

      void sendMessage(MessageType.CancelDownload, { videoIds });
      void crossWorldMessenger.sendMessage(CrossWorldMessage.CancelDownload, { videoIds });
    });

    onMessage(MessageType.ExecuteDownloadItem, ({ data }) => {
      if (location.pathname !== "/watch") {
        return;
      }

      if (data.playlistId) {
        setPlaylistContext(data.videoId, {
          playlistId: data.playlistId,
          playlistTitle: data.playlistTitle ?? "Playlist",
          playlistTotalCount: data.playlistTotalCount ?? 1
        });
      }

      uncancelStreamTransfer(data.videoId);
      void crossWorldMessenger.sendMessage(CrossWorldMessage.DownloadRequest, data);
    });

    onMessage(MessageType.UpdateDownloadProgress, ({ data }) => {
      void crossWorldMessenger.sendMessage(CrossWorldMessage.Progress, data);

      const isDownloading = !data.isRemoved && data.progress < 1;
      const isDone = data.isRemoved || data.progress >= 1;
      const progress = data.isRemoved ? 1 : data.progress;
      const progressType = data.isRemoved ? "" : data.progressType;
      downloadProgressStore.set(data.videoId, { isDownloading, isDone, isQueued: false, progress, progressType });
    });

    crossWorldMessenger.onMessage(CrossWorldMessage.StreamData, ({ data }) => {
      void handleStreamData(data);
    });

    crossWorldMessenger.onMessage(CrossWorldMessage.StreamError, ({ data }) => {
      void handleStreamError(data);
    });

    crossWorldMessenger.onMessage(CrossWorldMessage.IframePlayerReady, ({ data }) => {
      void sendMessage(MessageType.DownloadIframeReady, { videoId: data.videoId });
    });

    crossWorldMessenger.onMessage(CrossWorldMessage.DownloadRequest, ({ data }) => {
      uncancelStreamTransfer(data.videoId);
    });

    // Sync SABR/CDN download progress (from MAIN world) into downloadProgressStore
    // so the panel and popup reflect byte-level progress before muxing begins.
    crossWorldMessenger.onMessage(CrossWorldMessage.DownloadProgress, ({ data }) => {
      downloadProgressStore.set(data.videoId, {
        isDownloading: true,
        isDone: false,
        progress: data.progress,
        progressType: data.progressType
      });
    });

    // Proxy fetch requests from MAIN world through the background SW, which has
    // host_permissions for googlevideo.com and bypasses CORS without preflight.
    crossWorldMessenger.onMessage(
      CrossWorldMessage.ProxyFetch,
      ({ data }) => sendMessage(MessageType.BackgroundProxyFetch, data)
    );

    listenForInterruptedDownloadEvents();
    listenForSabrBodyReady();
    listenForKeepalive();
    listenForDownloadIframes(context);
    void forwardSabrCredentialsWithRetry();

    const unwatchOptions = optionsItem.watch(newOptions => {
      if (!newOptions) {
        return;
      }

      currentOptions = newOptions;
      setNativeDownloadVisibility(!currentOptions.isRemoveNativeDownload);
    });
    context.onInvalidated(unwatchOptions);

    if (!isDownloadIframe) {
      handlePageChange(location.href, context, currentOptions);
    }
  }
});
