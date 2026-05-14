import { buildDownloadRequest } from "./playlist-download-builder";
import { MessageType, sendMessage } from "@/lib/messaging/messaging";
import { downloadProgressStore, playlistMetadataSignal } from "@/lib/ui/synced-stores.svelte";
import {
  PlaylistDownloadMode,
  PlaylistOutputMode,
  ProgressType,
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

export function createBatchDownloadState(
  getOutputMode: () => PlaylistOutputMode,
  getDownloadMode: () => PlaylistDownloadMode,
  buildEffectiveOptions: () => Options,
  getEffectiveZipName: () => string
) {
  let isDownloading = $state(false);
  let totalCount = $state(0);
  let error = $state("");
  let activeDownloadRequests = $state<DownloadRequest[]>([]);
  let completedBatchProgress = $state(0);
  let currentZipBundleId = $state<string | null>(null);

  const batchDoneIds = new SvelteSet<string>();

  $effect(() => {
    for (const request of activeDownloadRequests) {
      if (batchDoneIds.has(request.videoId)) {
        continue;
      }

      const entry = downloadProgressStore.get(request.videoId);
      if (!entry || entry.isDone || entry.isFailed) {
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

    if (currentZipBundleId) {
      const zipEntry = downloadProgressStore.get(`zip:${currentZipBundleId}`);
      if (!zipEntry?.isDone) {
        return;
      }

      downloadProgressStore.deleteLocal(`zip:${currentZipBundleId}`);
      currentZipBundleId = null;
    }

    completedBatchProgress = 100;
    isDownloading = false;
    batchDownloadStatus.isRunning = false;
    batchDownloadStatus.isZipBatch = false;

    for (const request of activeDownloadRequests) {
      if (batchCanceledIds.has(request.videoId)) {
        continue;
      }

      downloadProgressStore.unsuppress(request.videoId);
      const entry = downloadProgressStore.get(request.videoId);
      if (entry && !entry.isDone && !entry.isFailed) {
        downloadProgressStore.setLocal(request.videoId, {
          isDownloading: false,
          isDone: true,
          progress: 1,
          progressType: entry.progressType ?? ProgressType.FFmpeg
        });
      }
    }

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
      downloadProgressStore.deleteLocal(video.videoId);
      downloadProgressStore.unsuppress(video.videoId);
      downloadProgressStore.setLocal(video.videoId, {
        isDownloading: true,
        isDone: false,
        progress: 0,
        progressType: ""
      });
    }

    const metadata = playlistMetadataSignal.value;
    const playlistId = metadata?.playlistId || `playlist-${Date.now()}`;
    const isZipBundle = getOutputMode() === PlaylistOutputMode.Zip;
    batchDownloadStatus.isZipBatch = isZipBundle;
    currentZipBundleId = isZipBundle ? playlistId : null;

    const resolvedOptions = buildEffectiveOptions();
    const zipName = getEffectiveZipName();
    const downloadRequests = videos.map(data =>
      buildDownloadRequest(data, resolvedOptions, playlistId, zipName, videos.length, isZipBundle));
    activeDownloadRequests = downloadRequests;

    try {
      await sendMessage(MessageType.RequestPlaylistDownload, {
        items: downloadRequests,
        playlistTitle: zipName,
        isZipBundle,
        isSequential: getDownloadMode() === PlaylistDownloadMode.DataSaver
      });
    } catch {
      error = "Failed to start downloads - please try again";
      isDownloading = false;
    }
  }

  async function cancelDownload() {
    const activeVideoIds = activeDownloadRequests
      .filter(request => downloadProgressStore.get(request.videoId)?.isDownloading)
      .map(request => request.videoId);
    if (activeVideoIds.length > 0) {
      await sendMessage(MessageType.CancelDownload, { videoIds: activeVideoIds });
    }

    completedBatchProgress = 0;
    isDownloading = false;
    batchDownloadStatus.isRunning = false;
    batchDownloadStatus.isZipBatch = false;
    batchVideoIds.clear();
    batchCanceledIds.clear();

    if (currentZipBundleId) {
      downloadProgressStore.deleteLocal(`zip:${currentZipBundleId}`);
      currentZipBundleId = null;
    }

    for (const request of activeDownloadRequests) {
      downloadProgressStore.delete(request.videoId);
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
