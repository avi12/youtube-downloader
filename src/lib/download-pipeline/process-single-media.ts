import { enqueueMuxJob, getFFmpeg, progressHandlers } from "./ffmpeg-instance";
import { toUint8Array, triggerDownload } from "./media-utils";
import { embedMusicMetadata } from "./music-metadata";
import { reportProgress } from "./pipeline-reporting";
import { addToPlaylistBundle } from "./playlist-bundle";
import { DownloadType, ProgressType } from "@/types";
import type { ProcessStreamData } from "@/types";

export async function processSingleMedia(item: ProcessStreamData) {
  const { videoId, type, filenameOutput, videoData, audioData, tabId } = item;
  const rawData = type === DownloadType.Audio ? audioData : videoData;
  let data = toUint8Array(rawData);
  if (!data) {
    return;
  }

  await reportProgress({
    videoId,
    progress: 0.99,
    progressType: type === DownloadType.Audio ? ProgressType.Audio : ProgressType.Video,
    tabId
  });

  if (type === DownloadType.Audio && item.metadata?.isMusic) {
    await reportProgress({ videoId, progress: 0, progressType: ProgressType.FFmpeg, tabId });

    function handleMusicFFmpegProgress({ progress }: { progress: number }) {
      void reportProgress({ videoId, progress, progressType: ProgressType.FFmpeg, tabId });
    }

    progressHandlers.add(handleMusicFFmpegProgress);
    try {
      await enqueueMuxJob(async () => {
        const ffmpeg = getFFmpeg();
        data = await embedMusicMetadata(data!, filenameOutput, item.metadata!, ffmpeg);
      });
    } finally {
      progressHandlers.delete(handleMusicFFmpegProgress);
    }

    await reportProgress({ videoId, progress: 1, progressType: ProgressType.FFmpeg, tabId });
  }

  await reportProgress({ videoId, progress: 1, progressType: ProgressType.FFmpeg, tabId });

  if (item.playlistId) {
    addToPlaylistBundle({
      playlistId: item.playlistId,
      playlistTitle: item.playlistTitle ?? "Playlist",
      totalCount: item.playlistTotalCount ?? 1,
      tabId,
      filename: filenameOutput,
      data
    });
    return;
  }

  await triggerDownload(data, filenameOutput);
}
