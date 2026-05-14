import { videoQueueItem } from "@/lib/storage/storage";
import { completedDownloadsStore } from "@/lib/ui/completed-downloads-store.svelte";
import { downloadProgressStore } from "@/lib/ui/synced-stores.svelte";
import type { VideoData } from "@/types";

export function createDownloadProgressTracker(
  getVideoData: () => VideoData,
  setDownloadId: (value: number | null) => void
) {
  $effect(() => {
    const { videoId } = getVideoData();
    const existing = completedDownloadsStore.get(videoId);
    if (existing) {
      setDownloadId(existing.downloadId);
    }

    return completedDownloadsStore.subscribe((completedVideoId, completed) => {
      if (completedVideoId !== videoId) {
        return;
      }

      setDownloadId(completed.downloadId);
    });
  });

  $effect(() => {
    const { videoId } = getVideoData();
    return videoQueueItem.watch(queue => {
      const currentQueue = queue ?? [];
      if (currentQueue[0]?.videoId !== videoId) {
        return;
      }

      downloadProgressStore.setLocal(videoId, {
        isDownloading: true,
        isDone: false,
        progress: 0,
        progressType: ""
      });
    });
  });
}
