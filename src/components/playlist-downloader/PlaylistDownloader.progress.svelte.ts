import { calculateBatchProgress, resolveCurrentPhaseLabel } from "./helpers/playlist-progress-helpers";
import type { createBatchDownloadState } from "./PlaylistDownloader.batch.svelte";
import { scrollVideoItemIntoView } from "./PlaylistDownloader.scroll";
import type { createVideoDataState } from "./PlaylistDownloader.video-data.svelte";
import { downloadProgressStore } from "@/lib/ui/synced-stores.svelte";

type BatchState = ReturnType<typeof createBatchDownloadState>;
type VideoDataState = ReturnType<typeof createVideoDataState>;

export function createProgressState(
  batch: BatchState,
  videoData: VideoDataState,
  getIsScrollSyncEnabled: () => boolean
) {
  const activeIndividualDownloadCount = $derived.by(() => {
    if (batch.isDownloading) {
      return 0;
    }

    let count = 0;
    for (const videoId of videoData.videoDataMap.keys()) {
      if (downloadProgressStore.get(videoId)?.isDownloading) {
        count++;
      }
    }
    return count;
  });

  const totalProgress = $derived(
    calculateBatchProgress(
      batch.isDownloading,
      batch.activeDownloadRequests,
      videoId => downloadProgressStore.get(videoId),
      batch.totalCount,
      batch.currentZipBundleId,
      activeIndividualDownloadCount,
      videoData.videoDataMap.keys(),
      batch.completedBatchProgress
    )
  );

  const activeDownloadVideoId = $derived.by(() => {
    if (!batch.isDownloading) {
      return null;
    }

    for (const request of batch.activeDownloadRequests) {
      if (downloadProgressStore.get(request.videoId)?.isDownloading) {
        return request.videoId;
      }
    }

    return null;
  });

  const currentPhaseLabel = $derived(
    resolveCurrentPhaseLabel(
      batch.isDownloading,
      batch.currentZipBundleId,
      batch.downloadedCount,
      batch.totalCount,
      activeDownloadVideoId,
      batch.activeDownloadRequests,
      videoId => downloadProgressStore.get(videoId),
      videoId => videoData.videoDataMap.get(videoId)
    )
  );

  const downloadButtonLabel = $derived.by(() => {
    if (batch.isDownloading) {
      return `Downloading ${batch.downloadedCount} of ${batch.totalCount}`;
    }

    const count = videoData.selectedDownloadableVideos.length;
    return count === 0 ? "Download selected" : `Download ${count} video${count === 1 ? "" : "s"}`;
  });

  $effect(() => {
    if (!getIsScrollSyncEnabled() || !activeDownloadVideoId) {
      return;
    }

    scrollVideoItemIntoView(activeDownloadVideoId);
  });

  return {
    get activeIndividualDownloadCount() {
      return activeIndividualDownloadCount;
    },
    get totalProgress() {
      return totalProgress;
    },
    get activeDownloadVideoId() {
      return activeDownloadVideoId;
    },
    get currentPhaseLabel() {
      return currentPhaseLabel;
    },
    get downloadButtonLabel() {
      return downloadButtonLabel;
    }
  };
}
