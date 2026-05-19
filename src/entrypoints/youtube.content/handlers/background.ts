import { checkInterruptedDownload } from "../download/interrupted-downloads";
import { CrossWorldEvent, emitCrossWorldEvent } from "@/lib/messaging/cross-world-events";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";
import { MessageType, onMessage } from "@/lib/messaging/messaging";
import { completedDownloadsStore } from "@/lib/ui/completed-downloads-store.svelte";
import { downloadProgressStore, interruptedDownloadStore } from "@/lib/ui/synced-stores.svelte";
import { ProgressType } from "@/types";

export function registerBackgroundMessageHandlers() {
  const lastReportedProgress = new Map<string, string>();

  // FFmpeg-phase completion arrives ~1s before `browser.downloads.download`
  // resolves and the file is actually on disk. We hold the UI at "downloading
  // 100%" until the save-complete notification fans out via this store, then
  // flip to `isDone`.
  completedDownloadsStore.subscribe(videoId => {
    downloadProgressStore.unsuppress(videoId);
    downloadProgressStore.setLocal(videoId, {
      isDownloading: false,
      isDone: true,
      progress: 1,
      progressType: ProgressType.FFmpeg
    });
    interruptedDownloadStore.delete(videoId);
    emitCrossWorldEvent({
      type: CrossWorldEvent.ProgressUpdate,
      data: {
        videoId,
        progress: 1,
        progressType: ProgressType.FFmpeg,
        isSaved: true
      }
    });
  });

  onMessage(MessageType.ExecuteDownloadItem, ({ data }) => {
    void crossWorldMessenger.sendMessage(CrossWorldMessage.DownloadRequest, data);
  });

  onMessage(MessageType.UpdateDownloadProgress, ({ data }) => {
    if (!data.isRemoved) {
      // Dedupe by progress AND progressType so the FFmpeg phase's final
      // progress=1 event isn't dropped just because the video phase already
      // reached progress=1 (different phases share the same progress scale).
      const reportedKey = `${data.progress}|${data.progressType}`;
      if (lastReportedProgress.get(data.videoId) === reportedKey) {
        return;
      }

      // Prevent backwards progress within the same phase — the download may
      // emit slightly out-of-order reports but the display must only advance.
      // Exception: an explicit reset (progress=0) comes from the fallback chain
      // (SABR → CDN → iframe) and must always pass through so the UI resets.
      const isExplicitReset = data.progress === 0;
      const currentEntry = downloadProgressStore.get(data.videoId);
      const isSamePhase = currentEntry?.progressType === data.progressType;
      const isProgressBackwards = data.progress < (currentEntry?.progress ?? 0);
      if (!isExplicitReset && isSamePhase && isProgressBackwards) {
        return;
      }

      if (isExplicitReset) {
        lastReportedProgress.delete(data.videoId);
      }

      lastReportedProgress.set(data.videoId, reportedKey);
    } else {
      lastReportedProgress.delete(data.videoId);
    }

    if (data.isRemoved) {
      if (data.isFailed) {
        downloadProgressStore.unsuppress(data.videoId);
        downloadProgressStore.setLocal(data.videoId, {
          isDownloading: false,
          isDone: false,
          progress: 0,
          progressType: data.progressType,
          isFailed: true
        });
      } else if (data.isInterrupted) {
        // Network went offline: clear the running state and sync the interrupted
        // entry from storage (written by the background before sending this message).
        downloadProgressStore.unsuppress(data.videoId);
        downloadProgressStore.setLocal(data.videoId, {
          isDownloading: false,
          isDone: false,
          progress: 0,
          progressType: data.progressType
        });
        void checkInterruptedDownload(data.videoId);
      } else {
        // Guard against the cancel-then-restart race: the background's cancel
        // response can arrive after the user has already restarted the download.
        // If a new download is running, this isRemoved is stale — drop it.
        const isStillDownloading = downloadProgressStore.get(data.videoId)?.isDownloading;
        if (isStillDownloading) {
          return;
        }

        downloadProgressStore.delete(data.videoId);
      }

      emitCrossWorldEvent({
        type: CrossWorldEvent.ProgressUpdate,
        data
      });
      return;
    }

    // Don't transition to `isDone` here even when FFmpeg phase hits 1 — the
    // file isn't actually on disk yet. `completedDownloadsStore.subscribe`
    // above flips us to done once `browser.downloads.download` resolves and
    // chrome.downloads reports state=complete.
    const wasSet = downloadProgressStore.setLocal(data.videoId, {
      isDownloading: true,
      isDone: false,
      progress: data.progress,
      progressType: data.progressType
    });
    if (!wasSet) {
      return;
    }

    emitCrossWorldEvent({
      type: CrossWorldEvent.ProgressUpdate,
      data
    });
  });
}
