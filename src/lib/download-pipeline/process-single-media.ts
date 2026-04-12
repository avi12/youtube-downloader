import { toUint8Array, triggerDownload } from ".";
import { reportProgress } from ".";
import { enqueueMuxJob, getFFmpeg, progressHandlers } from "./ffmpeg-instance";
import { embedMusicMetadata } from "./music-metadata";
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

    // Cap FFmpeg progress below 1 — progress=1 is signaled after file save.
    const ffmpegProgressCap = 0.99;

    function handleMusicFFmpegProgress({ progress }: { progress: number }) {
      const cappedProgress = Math.min(progress, ffmpegProgressCap);
      void reportProgress({ videoId, progress: cappedProgress, progressType: ProgressType.FFmpeg, tabId });
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
  }

  if (item.playlistId) {
    await reportProgress({ videoId, progress: 1, progressType: ProgressType.FFmpeg, tabId });
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
  await reportProgress({ videoId, progress: 1, progressType: ProgressType.FFmpeg, tabId });
}
