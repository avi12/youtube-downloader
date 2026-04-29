import { toUint8Array, triggerDownload } from ".";
import { reportProgress } from ".";
import { addToPlaylistBundle } from "./playlist-bundle";
import { processAudioWithFfmpeg } from "./process-single-audio";
import { getFileExtension } from "@/lib/utils/containers";
import { DownloadType, ProgressType } from "@/types";
import type { ProcessStreamData } from "@/types";

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
  if (isAudio) {
    await reportProgress({
      videoId,
      progress: 0,
      progressType: ProgressType.FFmpeg,
      tabId
    });
    data = await processAudioWithFfmpeg({
      videoId,
      tabId,
      data,
      filenameOutput,
      sourceExtension,
      metadata: item.metadata,
      isFlacTarget: outputExtension === "flac"
    });
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
      thumbnailUrl: item.metadata?.thumbnailUrl
    }
  });
  await reportProgress({
    videoId,
    progress: 1,
    progressType: ProgressType.FFmpeg,
    tabId
  });
}
