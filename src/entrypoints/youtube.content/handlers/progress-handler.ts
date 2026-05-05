import { CrossWorldEvent, emitCrossWorldEvent } from "@/lib/messaging/cross-world-events";
import { MessageType, onMessage } from "@/lib/messaging/messaging";
import { downloadProgressStore } from "@/lib/ui/synced-stores.svelte";
import { ProgressType } from "@/types";

const removedVideoIds = new Set<string>();

export function clearRemovedVideoId(videoId: string) {
  removedVideoIds.delete(videoId);
}

export function registerProgressHandler() {
  const lastReportedProgress = new Map<string, number>();

  onMessage(MessageType.UpdateDownloadProgress, ({ data }) => {
    if (!data.isRemoved) {
      if (removedVideoIds.has(data.videoId)) {
        return;
      }

      const last = lastReportedProgress.get(data.videoId);
      if (last !== undefined && last >= 1 && data.progress >= 1) {
        return;
      }

      lastReportedProgress.set(data.videoId, data.progress);
    } else {
      lastReportedProgress.delete(data.videoId);
      removedVideoIds.add(data.videoId);
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
