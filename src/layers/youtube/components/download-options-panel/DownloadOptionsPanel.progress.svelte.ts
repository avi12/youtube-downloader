import type { VideoData } from "@/types";
import { completedDownloadsStore } from "#youtube/lib/ui/completed-downloads-store.svelte";

export function createDownloadProgressTracker({
  getVideoData,
  setDownloadId
}: {
  getVideoData: () => VideoData;
  setDownloadId: (value: number | null) => void;
}) {
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
}
