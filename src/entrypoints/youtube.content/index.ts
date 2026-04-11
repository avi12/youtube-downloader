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
import { CrossWorldEvent, emitCrossWorldEvent } from "@/lib/cross-world-events";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/cross-world-messenger";
import { MessageType, onMessage, sendMessage } from "@/lib/messaging";
import { forwardSabrCredentialsWithRetry, listenForSabrBodyReady } from "@/lib/sabr-credentials";
import { optionsItem, statusProgressItem } from "@/lib/storage";
import { downloadProgressStore } from "@/lib/synced-stores.svelte";
import { type Options } from "@/types";

function registerCrossWorldHandlers(
  isDownloadIframe: boolean,
  context: InstanceType<typeof ContentScriptContext>,
  getOptions: () => Options
) {
  crossWorldMessenger.onMessage(CrossWorldMessage.VideoData, async ({ data }) => {
    await checkInterruptedDownload(data.videoId);
  });

  crossWorldMessenger.onMessage(CrossWorldMessage.Navigation, ({ data }) => {
    if (!isDownloadIframe) {
      handlePageChange(data.url, context, getOptions());
    }

    void forwardSabrCredentialsWithRetry();
  });

  crossWorldMessenger.onMessage(CrossWorldMessage.PanelContentReady, ({ data }) => {
    mountPanelUi({
      context,
      contentId: data.contentId,
      videoData: data.videoData,
      options: getOptions()
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
    void sendMessage(MessageType.StartBackgroundDownload, data);
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

function registerBackgroundMessageHandlers() {
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
    if (data.isRemoved) {
      downloadProgressStore.delete(data.videoId);
      emitCrossWorldEvent(CrossWorldEvent.ProgressUpdate, data);
      return;
    }

    const isComplete = data.progress >= 1;
    downloadProgressStore.setLocal(data.videoId, {
      isDownloading: !isComplete,
      isDone: isComplete,
      progress: data.progress,
      progressType: data.progressType
    });

    emitCrossWorldEvent(CrossWorldEvent.ProgressUpdate, data);
  });
}

async function restoreStoredProgress() {
  const storedProgress = await statusProgressItem.getValue();
  for (const [videoId, { progress, progressType }] of Object.entries(storedProgress)) {
    downloadProgressStore.set(videoId, {
      isDownloading: true,
      isDone: false,
      progress,
      progressType
    });
  }
}

export default defineContentScript({
  matches: ["https://www.youtube.com/*"],
  allFrames: true,
  async main(context) {
    const isDownloadIframe = self !== top && location.search.includes("ytdl=1");
    if (self !== top && !isDownloadIframe) {
      return;
    }

    let currentOptions: Options = await optionsItem.getValue();

    registerCrossWorldHandlers(isDownloadIframe, context, () => currentOptions);
    registerBackgroundMessageHandlers();
    listenForInterruptedDownloadEvents();
    listenForSabrBodyReady();
    listenForKeepalive();
    listenForDownloadIframes(context);
    void forwardSabrCredentialsWithRetry();

    await restoreStoredProgress();

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
