import { checkInterruptedDownload } from "../download/interrupted-downloads";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";
import { MessageType, onMessage } from "@/lib/messaging/messaging";
import { completedDownloadsStore } from "@/lib/ui/completed-downloads-store.svelte";
import { interruptedDownloadStore } from "@/lib/ui/synced-stores.svelte";

export function registerBackgroundMessageHandlers() {
  completedDownloadsStore.subscribe(videoId => {
    interruptedDownloadStore.delete(videoId);
  });

  onMessage(MessageType.ExecuteDownloadItem, ({ data }) => {
    crossWorldMessenger.sendMessage(CrossWorldMessage.DownloadRequest, data).catch(() => {});
  });

  // Progress, failure, and cancel state all flow through statusProgressItem
  // (chrome.storage.local) and reach the UI via statusProgressSignal. The
  // in-tab message handles only the interrupted-download lifecycle hook.
  onMessage(MessageType.UpdateDownloadProgress, ({ data }) => {
    if (!data.isRemoved) {
      return;
    }

    if (data.isInterrupted) {
      checkInterruptedDownload(data.videoId).catch(() => {});
    }
  });
}
