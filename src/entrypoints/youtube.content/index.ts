import { checkInterruptedDownload, listenForInterruptedDownloadEvents } from "./download/interrupted-downloads";
import { listenForKeepalive } from "./download/keepalive";
import {
  cancelStreamTransfer,
  handleStreamData,
  handleStreamError,
  setPlaylistContext,
  uncancelStreamTransfer
} from "./download/stream-transfer";
import "./style.css";
import { handlePageChange, setNativeDownloadVisibility } from "./ui/page-router";
import { mountPanelUi } from "./ui/panel-ui";
import { mountWatchToast } from "./ui/watch-toast";
import { CrossWorldEvent, emitCrossWorldEvent } from "@/lib/messaging/cross-world-events";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";
import { MessageType, onMessage, sendMessage } from "@/lib/messaging/messaging";
import { optionsItem, statusProgressItem } from "@/lib/storage/storage";
import { initCompletedDownloadsStore } from "@/lib/ui/completed-downloads-store.svelte";
import { downloadProgressStore, initContentOptions } from "@/lib/ui/synced-stores.svelte";
import { forwardSabrCredentialsWithRetry, listenForSabrBodyReady } from "@/lib/youtube/sabr/credentials";
import { initialOptions as defaultOptions } from "@/lib/youtube/video-helpers";
import { ProgressType } from "@/types";

function registerCrossWorldHandlers(
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
    downloadProgressStore.setLocal(data.videoId, {
      isDownloading: true,
      isDone: false,
      progress: 0,
      progressType: ""
    });
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

    // Only the offscreen download iframe should respond. Regular user-facing
    // YouTube watch tabs lack ?ytdl=1 and must ignore the broadcast so they
    // don't accidentally re-trigger a foreign download.
    const params = new URLSearchParams(location.search);
    if (params.get("ytdl") !== "1" || params.get("v") !== data.videoId) {
      return;
    }

    if (data.playlistId) {
      setPlaylistContext({
        videoId: data.videoId,
        context: {
          playlistId: data.playlistId,
          playlistTitle: data.playlistTitle ?? "Playlist",
          playlistTotalCount: data.playlistTotalCount ?? 1
        }
      });
    }

    uncancelStreamTransfer(data.videoId);
    void crossWorldMessenger.sendMessage(CrossWorldMessage.DownloadRequest, data);
  });

  const lastReportedProgress = new Map<string, string>();

  onMessage(MessageType.UpdateDownloadProgress, ({ data }) => {
    if (!data.isRemoved) {
      // Dedupe by progress AND progressType so the FFmpeg phase's final
      // progress=1 event isn't dropped just because the video phase already
      // reached progress=1 (different phases share the same progress scale).
      const reportedKey = `${data.progress}|${data.progressType}`;
      if (lastReportedProgress.get(data.videoId) === reportedKey) {
        return;
      }

      lastReportedProgress.set(data.videoId, reportedKey);
    } else {
      lastReportedProgress.delete(data.videoId);
    }

    if (data.isRemoved) {
      if (data.isFailed) {
        downloadProgressStore.setLocal(data.videoId, {
          isDownloading: false,
          isDone: false,
          progress: 0,
          progressType: data.progressType,
          isFailed: true
        });
      } else {
        downloadProgressStore.delete(data.videoId);
      }

      emitCrossWorldEvent({
        type: CrossWorldEvent.ProgressUpdate,
        data
      });
      return;
    }

    const isComplete = data.progress >= 1 && data.progressType === ProgressType.FFmpeg;
    downloadProgressStore.setLocal(data.videoId, {
      isDownloading: !isComplete,
      isDone: isComplete,
      progress: data.progress,
      progressType: data.progressType
    });

    emitCrossWorldEvent({
      type: CrossWorldEvent.ProgressUpdate,
      data
    });
  });
}

function syncStoredProgressToStore(storedProgress: Awaited<ReturnType<typeof statusProgressItem.getValue>>) {
  for (const [videoId, { progress, progressType }] of Object.entries(storedProgress)) {
    const isComplete = progress >= 1 && progressType === ProgressType.FFmpeg;
    downloadProgressStore.set(videoId, {
      isDownloading: !isComplete,
      isDone: isComplete,
      progress,
      progressType
    });
  }

  // A video that was downloading but is no longer in storage has finished
  for (const videoId of [...downloadProgressStore.keys()]) {
    if (!storedProgress[videoId] && downloadProgressStore.get(videoId)?.isDownloading) {
      downloadProgressStore.set(videoId, {
        isDownloading: false,
        isDone: true,
        progress: 1,
        progressType: ProgressType.FFmpeg
      });
    }
  }
}

async function restoreStoredProgress() {
  const storedProgress = await statusProgressItem.getValue();
  syncStoredProgressToStore(storedProgress);
}

export default defineContentScript({
  matches: ["https://www.youtube.com/*"],
  allFrames: true,
  async main(context) {
    const isDownloadIframe = self !== top && /ytdl=1/.test(location.search);
    if (self !== top && !isDownloadIframe) {
      return;
    }

    const currentOptions = await optionsItem.getValue();
    initContentOptions({
      ...defaultOptions,
      ...currentOptions
    });

    registerCrossWorldHandlers(isDownloadIframe, context);
    registerBackgroundMessageHandlers();
    listenForSabrBodyReady();
    void forwardSabrCredentialsWithRetry();

    if (!isDownloadIframe) {
      listenForInterruptedDownloadEvents();
      listenForKeepalive();
      initCompletedDownloadsStore();
      mountWatchToast(context);
      await restoreStoredProgress();

      const unwatchStatusProgress = statusProgressItem.watch(stored => {
        syncStoredProgressToStore(stored ?? {});
      });
      context.onInvalidated(unwatchStatusProgress);

      const unwatchOptions = optionsItem.watch(newOptions => {
        if (!newOptions) {
          return;
        }

        initContentOptions({
          ...defaultOptions,
          ...newOptions
        });
        setNativeDownloadVisibility(newOptions.isShowNativeDownload);
        void crossWorldMessenger.sendMessage(CrossWorldMessage.OptionsUpdate, {
          isShowNativeDownload: newOptions.isShowNativeDownload
        });
      });
      context.onInvalidated(unwatchOptions);

      handlePageChange({
        url: location.href,
        context
      });
    }
  }
});
