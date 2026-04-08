import { listenForDownloadIframes } from "./download-iframe";
import { checkInterruptedDownload, listenForInterruptedDownloadEvents } from "./interrupted-downloads";
import { listenForKeepalive } from "./keepalive";
import { handlePageChange, setNativeDownloadVisibility } from "./page-router";
import { mountPanelUi } from "./panel-ui";
import { listenForDownloadRequests } from "./sabr-download";
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
import { downloadProgressStore, SYNC_NAMESPACE, SyncKey } from "@/lib/synced-stores.svelte";
import type { Options } from "@/types";

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

    addEventListener("message", e => {
      if (e.data?.namespace !== SYNC_NAMESPACE || e.data.key !== SyncKey.CancelRequest) {
        return;
      }

      const { videoIds } = e.data.value ?? {};
      if (!videoIds) {
        return;
      }

      for (const id of videoIds) {
        cancelStreamTransfer(id);
      }

      void sendMessage(MessageType.CancelDownload, { videoIds });

      // postMessage instead of crossWorldMessenger to avoid looping back to this handler
      postMessage({ namespace: SYNC_NAMESPACE, key: SyncKey.CancelDownload, value: { videoIds } }, location.origin);
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

    onMessage(
      MessageType.RefreshPoToken,
      ({ data }) => crossWorldMessenger.sendMessage(CrossWorldMessage.RefreshPoToken, data)
    );

    onMessage(MessageType.UpdateDownloadProgress, ({ data }) => {
      void crossWorldMessenger.sendMessage(CrossWorldMessage.Progress, data);

      downloadProgressStore.set(data.videoId, data.isRemoved
        ? { isDownloading: false, isDone: true, isQueued: false, progress: 1, progressType: "" }
        : {
          isDownloading: data.progress < 1,
          isDone: data.progress >= 1,
          isQueued: false,
          progress: data.progress,
          progressType: data.progressType
        });
    });

    addEventListener("message", e => {
      if (e.data?.namespace !== SYNC_NAMESPACE || e.data.key !== SyncKey.StreamData) {
        return;
      }

      void handleStreamData(e.data.value);
    });

    crossWorldMessenger.onMessage(CrossWorldMessage.StreamError, ({ data }) => {
      void handleStreamError(data);
    });

    crossWorldMessenger.onMessage(CrossWorldMessage.IframePlayerReady, ({ data }) => {
      void sendMessage(MessageType.DownloadIframeReady, { videoId: data.videoId });
    });

    listenForInterruptedDownloadEvents();
    listenForSabrBodyReady();
    listenForDownloadRequests();
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
