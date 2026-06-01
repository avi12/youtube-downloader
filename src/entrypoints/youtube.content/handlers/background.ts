import { checkInterruptedDownload } from "../download/interrupted-downloads";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";
import { MessageType, onMessage } from "@/lib/messaging/messaging";
import { completedDownloadsStore } from "@/lib/ui/completed-downloads-store.svelte";
import { downloadProgressStore, interruptedDownloadStore } from "@/lib/ui/synced-stores.svelte";

export function registerBackgroundMessageHandlers() {
  completedDownloadsStore.subscribe(videoId => {
    downloadProgressStore.unsuppress(videoId);
    interruptedDownloadStore.delete(videoId);
  });

  onMessage(MessageType.ExecuteDownloadItem, ({ data }) => {
    void crossWorldMessenger.sendMessage(CrossWorldMessage.DownloadRequest, data);
  });

  // Progress updates flow through statusProgressItem (chrome.storage.local) and
  // reach downloadProgressStore via syncStoredProgressToStore. The in-tab message
  // handles only terminal transitions (removal, failure, interruption) so the
  // store and the popup share a single source of truth for the percentage.
  onMessage(MessageType.UpdateDownloadProgress, ({ data }) => {
    if (!data.isRemoved) {
      return;
    }

    if (data.isFailed) {
      downloadProgressStore.unsuppress(data.videoId);
      downloadProgressStore.set(data.videoId, {
        isDownloading: false,
        isDone: false,
        progress: 0,
        progressType: data.progressType,
        isFailed: true
      });
      return;
    }

    if (data.isInterrupted) {
      downloadProgressStore.unsuppress(data.videoId);
      downloadProgressStore.set(data.videoId, {
        isDownloading: false,
        isDone: false,
        progress: 0,
        progressType: data.progressType
      });
      void checkInterruptedDownload(data.videoId);
      return;
    }

    const isStillDownloading = downloadProgressStore.get(data.videoId)?.isDownloading;
    if (isStillDownloading && !data.isCancelled) {
      return;
    }

    downloadProgressStore.delete(data.videoId);
  });
}
