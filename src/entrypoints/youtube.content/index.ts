import { listenForInterruptedDownloadEvents } from "./download/interrupted-downloads";
import { listenForKeepalive } from "./download/keepalive";
import { registerBackgroundMessageHandlers } from "./handlers/background-message-handlers";
import { registerCrossWorldHandlers } from "./handlers/cross-world-handlers";
import "./style.css";
import { handlePageChange, setNativeDownloadVisibility } from "./ui/page-router";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";
import { optionsItem, statusProgressItem } from "@/lib/storage/storage";
import { downloadProgressStore, initContentOptions } from "@/lib/ui/synced-stores.svelte";
import { forwardSabrCredentialsWithRetry, listenForSabrBodyReady } from "@/lib/youtube/sabr/credentials";
import { initialOptions as defaultOptions } from "@/lib/youtube/video-helpers";
import { FactoryUrlParam } from "@/lib/youtube/youtube-url";

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
    const isFactoryIframe = self !== top && location.search.includes(`${FactoryUrlParam.TrustFactoryMode}=1`);
    if (isFactoryIframe) {
      registerBackgroundMessageHandlers();
      return;
    }

    if (self !== top) {
      return;
    }

    const currentOptions = await optionsItem.getValue();
    initContentOptions({
      ...defaultOptions,
      ...currentOptions
    });

    registerCrossWorldHandlers(false, context);
    registerBackgroundMessageHandlers();
    listenForSabrBodyReady();
    void forwardSabrCredentialsWithRetry();

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
});
