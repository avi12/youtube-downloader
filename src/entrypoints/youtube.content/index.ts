import { listenForKeepalive } from "./download/keepalive";
import { registerBackgroundMessageHandlers } from "./handlers/background";
import { registerCrossWorldHandlers } from "./handlers/cross-world";
import { restoreStoredProgress, syncStoredProgressToStore } from "./handlers/progress-sync";
import "./style.css";
import { setNativeDownloadVisibility } from "./ui/page-router";
import { handlePageChange } from "./ui/page-router";
import { mountWatchSnackbar } from "./ui/watch-snackbar";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";
import { optionsItem, statusProgressItem } from "@/lib/storage/storage";
import { initCompletedDownloadsStore } from "@/lib/ui/completed-downloads-store.svelte";
import { initContentOptions } from "@/lib/ui/synced-stores.svelte";
import { forwardSabrCredentialsWithRetry, listenForSabrBodyReady } from "@/lib/youtube/sabr/credentials";
import { INITIAL_OPTIONS as defaultOptions } from "@/lib/youtube/video-helpers";

const YTDL_IFRAME_QUERY_PARAM = "ytdl=1";

export default defineContentScript({
  matches: ["https://www.youtube.com/*"],
  allFrames: true,
  async main(context) {
    const isDownloadIframe = self !== top && location.search.includes(YTDL_IFRAME_QUERY_PARAM);
    const isUnrelatedIframe = self !== top && !isDownloadIframe;
    if (isUnrelatedIframe) {
      return;
    }

    if (isDownloadIframe) {
      // Register handlers before any await: MAIN world fires IframePlayerReady synchronously
      // at document_idle and we must not miss it with an async storage read in the way
      registerCrossWorldHandlers({
        isDownloadIframe,
        context
      });
      registerBackgroundMessageHandlers();
      listenForSabrBodyReady();
      void forwardSabrCredentialsWithRetry();
      const currentOptions = await optionsItem.getValue();
      initContentOptions({
        ...defaultOptions,
        ...currentOptions
      });
      return;
    }

    const currentOptions = await optionsItem.getValue();
    initContentOptions({
      ...defaultOptions,
      ...currentOptions
    });

    registerCrossWorldHandlers({
      isDownloadIframe,
      context
    });
    registerBackgroundMessageHandlers();
    listenForSabrBodyReady();
    void forwardSabrCredentialsWithRetry();

    listenForKeepalive();
    initCompletedDownloadsStore();
    mountWatchSnackbar(context);
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
});
