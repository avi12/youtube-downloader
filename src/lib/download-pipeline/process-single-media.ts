import {
  toUint8Array,
  triggerDownload,
  reportProgress,
  FFMPEG_PROGRESS_CAP,
  buildRecentContext
} from ".";
import { addToPlaylistBundle } from "./playlist-bundle";
import { applyAudioFfmpeg } from "./process-single-media-ffmpeg";
import { getFileExtension } from "@/lib/utils/containers";
import { DownloadType, ProgressType } from "@/types";
import type { ProcessStreamData } from "@/types";

function sourceAudioExtension(audioMimeType: string) {
  return audioMimeType.includes("webm") ? "weba" : "m4a";
}

export async function processSingleMedia({ item, isCancelled }: {
  item: ProcessStreamData;
  isCancelled: () => boolean;
}) {
  const { videoId, type, filenameOutput, videoData, audioData, tabId } = item;
  const rawData = type === DownloadType.Audio ? audioData : videoData;
  let data = toUint8Array(rawData);
  if (!data) {
    throw new Error("No stream data accumulated");
  }

  await reportProgress({
    videoId,
    progress: FFMPEG_PROGRESS_CAP,
    progressType: type === DownloadType.Audio ? ProgressType.Audio : ProgressType.Video,
    tabId
  });

  const isAudio = type === DownloadType.Audio;
  if (isAudio) {
    const sourceExtension = sourceAudioExtension(item.audioMimeType);
    const outputExtension = getFileExtension(filenameOutput);
    data = await applyAudioFfmpeg({
      videoId,
      tabId,
      data,
      sourceExtension,
      filenameOutput,
      outputExtension,
      metadata: item.metadata
    });
  }

  const isDownloadCancelled = isCancelled();
  if (isDownloadCancelled) {
    return;
  }

  const isPlaylistItem = Boolean(item.playlistId);
  if (isPlaylistItem) {
    await addToPlaylistBundle({
      playlistId: item.playlistId!,
      playlistTitle: item.playlistTitle ?? "Playlist",
      totalCount: item.playlistTotalCount ?? 1,
      tabId,
      filename: filenameOutput,
      data
    });
    await reportProgress({
      videoId,
      progress: 1,
      progressType: ProgressType.FFmpeg,
      tabId
    });
    return;
  }

  await triggerDownload({
    data,
    filenameOutput,
    recentContext: buildRecentContext(item, { audioMimeType: item.audioMimeType })
  });
  await reportProgress({
    videoId,
    progress: 1,
    progressType: ProgressType.FFmpeg,
    tabId
  });
}
