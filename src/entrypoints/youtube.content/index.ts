import { listenForInterruptedDownloadEvents } from "./download/interrupted-downloads";
import { listenForKeepalive } from "./download/keepalive";
import { uncancelStreamTransfer } from "./download/stream-transfer";
import { registerBackgroundMessageHandlers } from "./handlers/background-message-handlers";
import { registerCrossWorldHandlers } from "./handlers/cross-world-handlers";
import { registerScrubResultForwarder } from "./handlers/scrub-result-forwarder";
import "./style.css";
import { handlePageChange, setNativeDownloadVisibility } from "./ui/page-router";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";
import { IframeHostMessageType } from "@/lib/messaging/iframe-host-postmessage";
import { MessageType, sendMessage } from "@/lib/messaging/messaging";
import { optionsItem, statusProgressItem } from "@/lib/storage/storage";
import { downloadProgressStore, initContentOptions } from "@/lib/ui/synced-stores.svelte";
import { forwardSabrCredentialsWithRetry, listenForSabrBodyReady } from "@/lib/youtube/sabr/credentials";
import { initialOptions as defaultOptions } from "@/lib/youtube/video-helpers";
import { ScrubUrlParam } from "@/lib/youtube/youtube-url";
import type { DownloadRequest } from "@/types";

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
    if (location.search.includes(`${ScrubUrlParam.ScrubMode}=1`) || location.search.includes(`${ScrubUrlParam.TrustFactoryMode}=1`)) {
      void sendMessage(MessageType.BgDebugLog, {
        msg: `[ytdl:content-isolated] booted self===top=${self === top} url=${location.search.slice(0, 120)}`
      }).catch(error => console.warn("[ytdl:content-isolated] sendMessage failed:", error));
    }

    if (location.search.includes(`${ScrubUrlParam.ScrubMode}=1`)) {
      registerScrubResultForwarder();
      return;
    }

    const isDownloadIframe = self !== top && location.search.includes(`${ScrubUrlParam.Ytdl}=1`);
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

    if (isDownloadIframe) {
      addEventListener("message", e => {
        if (e.data?.ytdlType !== IframeHostMessageType.ExecuteDownload) {
          return;
        }

        const request: DownloadRequest = e.data.request;
        uncancelStreamTransfer(request.videoId);
        void crossWorldMessenger.sendMessage(CrossWorldMessage.DownloadRequest, request);
      });
    }

    if (!isDownloadIframe) {
      listenForInterruptedDownloadEvents();
      listenForKeepalive();
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
