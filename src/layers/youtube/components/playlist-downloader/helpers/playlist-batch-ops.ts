import { buildDownloadRequest } from "./playlist-download-builder";
import { MessageType, sendMessage } from "@/lib/messaging/messaging";
import { performCancelDownload } from "@/lib/ui/cancel-download";
import { playlistMetadataSignal } from "@/lib/ui/synced-stores.svelte";
import { PlaylistDownloadMode, PlaylistOutputMode } from "@/types";
import type { DownloadRequest, Options, VideoData } from "@/types";
import { cancelStreamTransfer } from "#youtube/entrypoints/youtube.content/download/stream-transfer";

const PLAYLIST_ID_PREFIX = "playlist-";

export async function cancelDownloads(videoIds: string[]) {
  if (videoIds.length === 0) {
    return;
  }

  for (const videoId of videoIds) {
    cancelStreamTransfer(videoId);
  }

  await performCancelDownload(videoIds);
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
