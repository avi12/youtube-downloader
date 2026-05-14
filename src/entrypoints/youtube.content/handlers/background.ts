import { checkInterruptedDownload } from "../download/interrupted-downloads";
import { CrossWorldEvent, emitCrossWorldEvent } from "@/lib/messaging/cross-world-events";
import { MessageType, onMessage } from "@/lib/messaging/messaging";
import { downloadProgressStore, interruptedDownloadStore } from "@/lib/ui/synced-stores.svelte";
import { ProgressType } from "@/types";

export function registerBackgroundMessageHandlers() {
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

      // Prevent backwards progress within the same phase — the download may
      // emit slightly out-of-order reports but the display must only advance.
      const currentEntry = downloadProgressStore.get(data.videoId);
      const isSamePhase = currentEntry?.progressType === data.progressType;
      if (isSamePhase && data.progress < (currentEntry?.progress ?? 0)) {
        return;
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
        if (downloadProgressStore.get(data.videoId)?.isDownloading) {
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

    const isComplete = data.progress >= 1 && data.progressType === ProgressType.FFmpeg;
    const wasSet = downloadProgressStore.setLocal(data.videoId, {
      isDownloading: !isComplete,
      isDone: isComplete,
      progress: data.progress,
      progressType: data.progressType
    });
    if (!wasSet) {
      return;
    }

    if (isComplete) {
      interruptedDownloadStore.delete(data.videoId);
    }

    emitCrossWorldEvent({
      type: CrossWorldEvent.ProgressUpdate,
      data
    });
  });
}
