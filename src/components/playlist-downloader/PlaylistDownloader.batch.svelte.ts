import {
  buildBatchDownloadRequests,
  cancelActiveDownloads,
  finalizeBatchVideoProgress,
  initBatchVideoProgress,
  sendBatchDownloadMessage
} from "./helpers/playlist-batch-ops";
import { ZIP_PROGRESS_KEY_PREFIX } from "./helpers/playlist-progress-helpers";
import { downloadProgressStore } from "@/lib/ui/synced-stores.svelte";
import {
  PlaylistDownloadMode,
  PlaylistOutputMode,
  type DownloadRequest,
  type Options,
  type VideoData
} from "@/types";
import { SvelteSet } from "svelte/reactivity";

export const batchDownloadStatus = $state({
  isRunning: false,
  isZipBatch: false
});
export const batchVideoIds = new SvelteSet<string>();
export const batchCanceledIds = new SvelteSet<string>();

export function createBatchDownloadState({
  getOutputMode,
  getDownloadMode,
  buildEffectiveOptions,
  getEffectiveZipName
}: {
  getOutputMode: () => PlaylistOutputMode;
  getDownloadMode: () => PlaylistDownloadMode;
  buildEffectiveOptions: () => Options;
  getEffectiveZipName: () => string;
}) {
  let isDownloading = $state(false);
  let totalCount = $state(0);
  let error = $state("");
  let activeDownloadRequests = $state<DownloadRequest[]>([]);
  let completedBatchProgress = $state(0);
  let currentZipBundleId = $state<string | null>(null);

  const batchDoneIds = new SvelteSet<string>();

  $effect(() => {
    for (const request of activeDownloadRequests) {
      const isAlreadyDone = batchDoneIds.has(request.videoId);
      if (isAlreadyDone) {
        continue;
      }

      const entry = downloadProgressStore.get(request.videoId);
      const isTerminal = !entry || entry.isDone || entry.isFailed;
      if (isTerminal) {
        batchDoneIds.add(request.videoId);
      }
    }
  });

  const downloadedCount = $derived(
    activeDownloadRequests.filter(request => batchDoneIds.has(request.videoId)).length
  );

  $effect(() => {
    const isBatchIncomplete = !isDownloading || totalCount === 0 || downloadedCount < totalCount;
    if (isBatchIncomplete) {
      return;
    }

    const isWaitingForZip = currentZipBundleId;
    if (isWaitingForZip) {
      const zipEntry = downloadProgressStore.get(`${ZIP_PROGRESS_KEY_PREFIX}${currentZipBundleId}`);
      const isZipDone = zipEntry?.isDone ?? false;
      if (!isZipDone) {
        return;
      }

      downloadProgressStore.deleteLocal(`${ZIP_PROGRESS_KEY_PREFIX}${currentZipBundleId}`);
      currentZipBundleId = null;
    }

    completedBatchProgress = 100;
    isDownloading = false;
    batchDownloadStatus.isRunning = false;
    batchDownloadStatus.isZipBatch = false;

    finalizeBatchVideoProgress({
      activeDownloadRequests,
      canceledIds: batchCanceledIds
    });

    batchVideoIds.clear();
    batchCanceledIds.clear();
  });

  async function startDownload(videos: readonly VideoData[]) {
    if (videos.length === 0) {
      return;
    }

    completedBatchProgress = 0;
    error = "";
    isDownloading = true;
    batchDownloadStatus.isRunning = true;
    batchVideoIds.clear();
    batchCanceledIds.clear();
    totalCount = videos.length;
    batchDoneIds.clear();

    for (const video of videos) {
      batchVideoIds.add(video.videoId);
    }

    initBatchVideoProgress(videos);

    const { playlistId, isZipBundle, zipName, downloadRequests } = buildBatchDownloadRequests({
      videos,
      resolvedOptions: buildEffectiveOptions(),
      getOutputMode,
      getEffectiveZipName
    });
    batchDownloadStatus.isZipBatch = isZipBundle;
    currentZipBundleId = isZipBundle ? playlistId : null;
    activeDownloadRequests = downloadRequests;

    try {
      await sendBatchDownloadMessage({
        downloadRequests,
        zipName,
        isZipBundle,
        getDownloadMode
      });
    } catch {
      error = "Failed to start downloads - please try again";
      isDownloading = false;
    }
  }

  async function cancelDownload() {
    await cancelActiveDownloads(activeDownloadRequests);

    completedBatchProgress = 0;
    isDownloading = false;
    batchDownloadStatus.isRunning = false;
    batchDownloadStatus.isZipBatch = false;
    batchVideoIds.clear();
    batchCanceledIds.clear();

    if (currentZipBundleId) {
      downloadProgressStore.deleteLocal(`${ZIP_PROGRESS_KEY_PREFIX}${currentZipBundleId}`);
      currentZipBundleId = null;
    }
  }

  return {
    get isDownloading() {
      return isDownloading;
    },
    get totalCount() {
      return totalCount;
    },
    get error() {
      return error;
    },
    get downloadedCount() {
      return downloadedCount;
    },
    get activeDownloadRequests() {
      return activeDownloadRequests;
    },
    get completedBatchProgress() {
      return completedBatchProgress;
    },
    get currentZipBundleId() {
      return currentZipBundleId;
    },
    startDownload,
    cancelDownload
  };
}
