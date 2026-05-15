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

export default defineContentScript({
  matches: ["https://www.youtube.com/*"],
  allFrames: true,
  async main(context) {
    const isDownloadIframe = self !== top && /ytdl=1/.test(location.search);
    const isUnrelatedIframe = self !== top && !isDownloadIframe;
    if (isUnrelatedIframe) {
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

    if (!isDownloadIframe) {
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
  }
});
