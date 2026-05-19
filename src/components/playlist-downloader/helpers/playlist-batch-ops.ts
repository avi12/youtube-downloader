import { buildDownloadRequest } from "./playlist-download-builder";
import { MessageType, sendMessage } from "@/lib/messaging/messaging";
import { downloadProgressStore, playlistMetadataSignal } from "@/lib/ui/synced-stores.svelte";
import { PlaylistDownloadMode, PlaylistOutputMode, ProgressType } from "@/types";
import type { DownloadRequest, Options, VideoData } from "@/types";

const PLAYLIST_ID_PREFIX = "playlist-";

export function initBatchVideoProgress(videos: readonly VideoData[]) {
  for (const video of videos) {
    downloadProgressStore.deleteLocal(video.videoId);
    downloadProgressStore.unsuppress(video.videoId);
    downloadProgressStore.setLocal(video.videoId, {
      isDownloading: true,
      isDone: false,
      progress: 0,
      progressType: ""
    });
  }
}

export function finalizeBatchVideoProgress({
  activeDownloadRequests,
  canceledIds
}: {
  activeDownloadRequests: DownloadRequest[];
  canceledIds: ReadonlySet<string>;
}) {
  for (const request of activeDownloadRequests) {
    const isCanceled = canceledIds.has(request.videoId);
    if (isCanceled) {
      continue;
    }

    downloadProgressStore.unsuppress(request.videoId);
    const entry = downloadProgressStore.get(request.videoId);
    const isIncompleteEntry = entry && !entry.isDone && !entry.isFailed;
    if (isIncompleteEntry) {
      downloadProgressStore.setLocal(request.videoId, {
        isDownloading: false,
        isDone: true,
        progress: 1,
        progressType: entry.progressType ?? ProgressType.FFmpeg
      });
    }
  }
}

export async function cancelActiveDownloads(activeDownloadRequests: DownloadRequest[]) {
  const activeVideoIds = activeDownloadRequests
    .filter(request => downloadProgressStore.get(request.videoId)?.isDownloading)
    .map(request => request.videoId);
  const hasActiveDownloads = activeVideoIds.length > 0;
  if (hasActiveDownloads) {
    await sendMessage(MessageType.CancelDownload, { videoIds: activeVideoIds });
  }

  for (const request of activeDownloadRequests) {
    downloadProgressStore.delete(request.videoId);
  }
}

export function buildBatchDownloadRequests({
  videos,
  resolvedOptions,
  getOutputMode,
  getEffectiveZipName
}: {
  videos: readonly VideoData[];
  resolvedOptions: Options;
  getOutputMode: () => PlaylistOutputMode;
  getEffectiveZipName: () => string;
}) {
  const metadata = playlistMetadataSignal.value;
  const playlistId = metadata?.playlistId || `${PLAYLIST_ID_PREFIX}${Date.now()}`;
  const isZipBundle = getOutputMode() === PlaylistOutputMode.Zip;
  const zipName = getEffectiveZipName();
  const downloadRequests = videos.map(data =>
    buildDownloadRequest({
      data,
      options: resolvedOptions,
      playlistId,
      playlistTitle: zipName,
      playlistTotalCount: videos.length,
      isZipBundle
    }));
  return {
    playlistId,
    isZipBundle,
    zipName,
    downloadRequests
  };
}

export async function sendBatchDownloadMessage({
  downloadRequests,
  zipName,
  isZipBundle,
  getDownloadMode
}: {
  downloadRequests: DownloadRequest[];
  zipName: string;
  isZipBundle: boolean;
  getDownloadMode: () => PlaylistDownloadMode;
}) {
  await sendMessage(MessageType.RequestPlaylistDownload, {
    items: downloadRequests,
    playlistTitle: zipName,
    isZipBundle,
    isSequential: getDownloadMode() === PlaylistDownloadMode.DataSaver
  });
}
