import { listenForDownloadIframes } from "./download/download-iframe";
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
import { CrossWorldEvent, emitCrossWorldEvent } from "@/lib/messaging/cross-world-events";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";
import { MessageType, onMessage, sendMessage } from "@/lib/messaging/messaging";
import { optionsItem, statusProgressItem } from "@/lib/storage/storage";
import { downloadProgressStore, initContentOptions } from "@/lib/ui/synced-stores.svelte";
import { uint8ToBase64 } from "@/lib/utils/binary";
import { forwardSabrCredentialsWithRetry, listenForSabrBodyReady } from "@/lib/youtube/sabr-credentials";
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
    void sendMessage(MessageType.StartBackgroundDownload, data);
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
}

function registerBackgroundMessageHandlers() {
  onMessage(MessageType.BgDebugLog, ({ data }) => {
    console.log(data.msg);
  });

  let cachedSabrTemplate: {
    url: string;
    bodyBase64: string;
    capturedAt: number;
  } | null = null;

  const factoryParams = new URLSearchParams(location.search);
  const isTrustFactoryMode = factoryParams.get("ytdlTrustFactoryMode") === "1";
  const factoryVideoId = factoryParams.get("v") ?? "";
  const factoryId = factoryParams.get("ytdlFactoryId") ?? "";

  if (isTrustFactoryMode) {
    void sendMessage(MessageType.BgDebugLog, {
      msg: `[ytdl:factory-isolated] handler registered factoryId=${factoryId} videoId=${factoryVideoId}`
    });
  }

  let factoryTemplateSent = false;
  crossWorldMessenger.onMessage(CrossWorldMessage.SabrTemplateCaptured, ({ data }) => {
    cachedSabrTemplate = data;

    if (isTrustFactoryMode) {
      void sendMessage(MessageType.BgDebugLog, {
        msg: `[ytdl:factory-isolated] received SabrTemplateCaptured factoryId=${factoryId} bodyB64Len=${data.bodyBase64.length} sent=${factoryTemplateSent}`
      });
    }

    // Factory-mode iframes forward the first post-ad template to BG, keyed
    // by factoryId so multiple parallel factory iframes (one per offset)
    // don't race the same Promise on the BG side.
    if (isTrustFactoryMode && !factoryTemplateSent && factoryVideoId) {
      factoryTemplateSent = true;
      void sendMessage(MessageType.SabrTemplateReady, {
        videoId: factoryVideoId,
        factoryId,
        url: data.url,
        bodyBase64: data.bodyBase64,
        capturedAt: data.capturedAt
      });
    }
  });

  onMessage(MessageType.GetSabrTemplateFromTab, async () => {
    if (cachedSabrTemplate) {
      return cachedSabrTemplate;
    }

    // Cache miss (push from MAIN was lost in a timing race) — pull MAIN's
    // current template once via cross-world request/response.
    const pulled = await crossWorldMessenger.sendMessage(
      CrossWorldMessage.PullSabrTemplate,
      {}
    ).catch(() => null);
    if (pulled) {
      cachedSabrTemplate = pulled;
    }

    return cachedSabrTemplate;
  });

  onMessage(MessageType.ExecuteDownloadItem, ({ data }) => {
    if (location.pathname !== "/watch") {
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

  const lastReportedProgress = new Map<string, number>();

  onMessage(MessageType.UpdateDownloadProgress, ({ data }) => {
    if (!data.isRemoved) {
      const last = lastReportedProgress.get(data.videoId);
      if (last !== undefined && last >= 1 && data.progress >= 1) {
        return;
      }

      lastReportedProgress.set(data.videoId, data.progress);
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

function registerScrubResultForwarder() {
  crossWorldMessenger.onMessage(CrossWorldMessage.IframeScrubSegment, ({ data }) => {
    void sendMessage(MessageType.IframeScrubSegmentReady, {
      videoId: data.videoId,
      scrubIndex: data.scrubIndex,
      videoBase64: uint8ToBase64(data.videoBytes),
      audioBase64: uint8ToBase64(data.audioBytes),
      videoMimeType: data.videoMimeType,
      audioMimeType: data.audioMimeType
    });
  });
}

export default defineContentScript({
  matches: ["https://www.youtube.com/*"],
  allFrames: true,
  async main(context) {
    if (self === top && /ytdlScrubMode=1/.test(location.search)) {
      registerScrubResultForwarder();
      return;
    }

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
      listenForDownloadIframes(context);
      await restoreStoredProgress();

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
