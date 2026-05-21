import { checkInterruptedDownload } from "../download/interrupted-downloads";
import { CrossWorldEvent, emitCrossWorldEvent } from "@/lib/messaging/cross-world-messenger";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";
import { MessageType, onMessage } from "@/lib/messaging/messaging";
import { completedDownloadsStore } from "@/lib/ui/completed-downloads-store.svelte";
import { downloadProgressStore, interruptedDownloadStore } from "@/lib/ui/synced-stores.svelte";
import { ProgressType } from "@/types";

export function registerBackgroundMessageHandlers() {
  const lastReportedProgress = new Map<string, string>();

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
      const reportedKey = `${data.progress}|${data.progressType}`;
      const isDuplicateReport = lastReportedProgress.get(data.videoId) === reportedKey;
      if (isDuplicateReport) {
        return;
      }

      const isExplicitReset = data.progress === 0;
      const currentEntry = downloadProgressStore.get(data.videoId);
      const isSamePhase = currentEntry?.progressType === data.progressType;
      const isProgressBackwards = data.progress < (currentEntry?.progress ?? 0);
      const shouldDropBackwardsProgress = !isExplicitReset && isSamePhase && isProgressBackwards;
      if (shouldDropBackwardsProgress) {
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
        downloadProgressStore.unsuppress(data.videoId);
        downloadProgressStore.setLocal(data.videoId, {
          isDownloading: false,
          isDone: false,
          progress: 0,
          progressType: data.progressType
        });
        void checkInterruptedDownload(data.videoId);
      } else {
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
