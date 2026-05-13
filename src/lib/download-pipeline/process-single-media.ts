import {
  toUint8Array,
  triggerDownload,
  reportProgress,
  FFMPEG_PROGRESS_CAP,
  toOwnedArrayBuffer
} from ".";
import { runEmbedMetadata, runTranscodeAudio } from "./ffmpeg-instance";
import { addToPlaylistBundle } from "./playlist-bundle";
import { getFileExtension } from "@/lib/utils/containers";
import { DownloadType, ProgressType } from "@/types";
import type { ProcessStreamData } from "@/types";

function sourceAudioExtension(audioMimeType: string) {
  return audioMimeType.includes("webm") ? "weba" : "m4a";
}

export async function processSingleMedia(item: ProcessStreamData, isCancelled: () => boolean) {
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
  const sourceExtension = isAudio ? sourceAudioExtension(item.audioMimeType) : "";
  const outputExtension = getFileExtension(filenameOutput);
  const isFlacTarget = isAudio && outputExtension === "flac";
  if (isAudio && item.metadata?.isMusic) {
    await reportProgress({
      videoId,
      progress: 0,
      progressType: ProgressType.FFmpeg,
      tabId
    });
    const audioBuffer = toOwnedArrayBuffer(data);
    data = await runEmbedMetadata(
      videoId,
      {
        audioData: audioBuffer,
        filenameOutput,
        sourceExtension,
        metadata: item.metadata,
        thumbnailUrl: item.metadata.thumbnailUrl,
        videoId,
        tabId
      }
    );
  } else if (isFlacTarget) {
    await reportProgress({
      videoId,
      progress: 0,
      progressType: ProgressType.FFmpeg,
      tabId
    });
    const audioBuffer = toOwnedArrayBuffer(data);
    data = await runTranscodeAudio(
      videoId,
      {
        audioData: audioBuffer,
        sourceExtension,
        filenameOutput,
        videoId,
        tabId
      }
    );
  }

  if (isCancelled()) {
    return;
  }

  if (item.playlistId) {
    await addToPlaylistBundle({
      playlistId: item.playlistId,
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
    recentContext: {
      videoId,
      title: item.metadata?.title ?? filenameOutput,
      channel: item.metadata?.artist ?? "",
      thumbnailUrl: item.metadata?.thumbnailUrl,
      audioMimeType: item.audioMimeType
    }
  });
  await reportProgress({
    videoId,
    progress: 1,
    progressType: ProgressType.FFmpeg,
    tabId
  });
}
