import { statusProgressItem } from "@/lib/storage/storage";
import { downloadProgressStore } from "@/lib/ui/synced-stores.svelte";
import { ProgressType } from "@/types";

export function syncStoredProgressToStore(
  storedProgress: Awaited<ReturnType<typeof statusProgressItem.getValue>>
) {
  for (const [videoId, { progress, progressType }] of Object.entries(storedProgress)) {
    const isComplete = progress >= 1 && progressType === ProgressType.FFmpeg;
    downloadProgressStore.set(videoId, {
      isDownloading: !isComplete,
      isDone: isComplete,
      progress,
      progressType
    });
  }

  // A video that was downloading but is no longer in storage has finished
  for (const videoId of downloadProgressStore.keys()) {
    const isOrphanedDownload = !storedProgress[videoId] && downloadProgressStore.get(videoId)?.isDownloading;
    if (isOrphanedDownload) {
      downloadProgressStore.set(videoId, {
        isDownloading: false,
        isDone: true,
        progress: 1,
        progressType: ProgressType.FFmpeg
      });
    }
  }
}

export async function restoreStoredProgress() {
  const storedProgress = await statusProgressItem.getValue();
  syncStoredProgressToStore(storedProgress);
}
