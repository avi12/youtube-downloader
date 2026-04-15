import { toUint8Array, triggerDownload } from ".";
import { reportProgress } from ".";
import { enqueueMuxJob, getFFmpeg, progressHandlers } from "./ffmpeg-instance";
import { embedMusicMetadata } from "./music-metadata";
import { addToPlaylistBundle } from "./playlist-bundle";
import { transcodeAudio } from "./transcode-audio";
import { DownloadType, ProgressType } from "@/types";
import type { ProcessStreamData } from "@/types";
import { getFileExtension } from "~/lib/utils/containers";

function sourceAudioExtension(audioMimeType: string) {
  return audioMimeType.includes("webm") ? "weba" : "m4a";
}

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

  const isAudio = type === DownloadType.Audio;
  const sourceExtension = isAudio ? sourceAudioExtension(item.audioMimeType) : "";
  const outputExtension = getFileExtension(filenameOutput);
  const isFlacTarget = isAudio && outputExtension === "flac";

  const ffmpegProgressCap = 0.99;
  function handleFfmpegProgress({ progress }: {
    progress: number;
  }) {
    void reportProgress({
      videoId,
      progress: Math.min(progress, ffmpegProgressCap),
      progressType: ProgressType.FFmpeg,
      tabId
    });
  }

  if (isAudio && item.metadata?.isMusic) {
    const metadata = item.metadata;
    await reportProgress({ videoId, progress: 0, progressType: ProgressType.FFmpeg, tabId });

    progressHandlers.add(handleFfmpegProgress);
    try {
      await enqueueMuxJob(async () => {
        const ffmpeg = getFFmpeg();
        const audioData = data;
        if (!audioData) {
          return;
        }

        data = await embedMusicMetadata({
          audioData, filenameOutput, sourceExtension, metadata, ffmpeg
        });
      });
    } finally {
      progressHandlers.delete(handleFfmpegProgress);
    }
  } else if (isFlacTarget) {
    // FLAC can't hold AAC/Opus, so re-encode even without music metadata to embed.
    await reportProgress({ videoId, progress: 0, progressType: ProgressType.FFmpeg, tabId });

    progressHandlers.add(handleFfmpegProgress);
    try {
      await enqueueMuxJob(async () => {
        const ffmpeg = getFFmpeg();
        const audioData = data;
        if (!audioData) {
          return;
        }

        data = await transcodeAudio({ audioData, sourceExtension, filenameOutput, ffmpeg });
      });
    } finally {
      progressHandlers.delete(handleFfmpegProgress);
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

  await triggerDownload({
    data,
    filenameOutput,
    recentContext: {
      videoId,
      title: item.metadata?.title ?? filenameOutput,
      channel: item.metadata?.artist ?? "",
      thumbnailUrl: item.metadata?.thumbnailUrl
    }
  });
  await reportProgress({ videoId, progress: 1, progressType: ProgressType.FFmpeg, tabId });
}
