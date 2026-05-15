import {
  toUint8Array,
  reportProgress,
  toOwnedArrayBuffer,
  buildRecentContext,
  triggerDownload
} from ".";
import {
  buildExtraAudioTracks,
  buildSubtitleFiles,
  handleSingleStream,
  resolveDownloadFilename
} from "./build-mux-job";
import { runMuxVideoAudio } from "./ffmpeg-instance";
import { addToPlaylistBundle } from "./playlist-bundle";
import { ProgressType } from "@/types";
import type { ProcessStreamData } from "@/types";

export async function processVideoAudio({ item, isCancelled }: {
  item: ProcessStreamData;
  isCancelled: () => boolean;
}) {
  const {
    videoId, filenameOutput, videoMimeType, audioMimeType, tabId,
    additionalAudioStreams, subtitleTracks, primaryAudioLanguageCode, defaultAudioTrackIndex
  } = item;

  const videoData = toUint8Array(item.videoData);
  const audioData = toUint8Array(item.audioData);
  const isMissingStream = !videoData || !audioData;
  if (isMissingStream) {
    await handleSingleStream({
      item,
      videoData,
      audioData
    });
    return;
  }

  await reportProgress({
    videoId,
    progress: 0,
    progressType: ProgressType.FFmpeg,
    tabId
  });

  const downloadFilename = resolveDownloadFilename({
    filenameOutput,
    hasExtraTracks: additionalAudioStreams.length > 0
  });

  const output = await runMuxVideoAudio({
    videoId,
    job: {
      videoData: toOwnedArrayBuffer(videoData),
      audioData: toOwnedArrayBuffer(audioData),
      extraAudioTracks: buildExtraAudioTracks(additionalAudioStreams),
      subtitleTracks: buildSubtitleFiles(subtitleTracks),
      videoMimeType,
      audioMimeType,
      videoId,
      tabId,
      primaryAudioLabel: item.primaryAudioLabel ?? "",
      primaryAudioLanguageCode: primaryAudioLanguageCode ?? "",
      defaultAudioTrackIndex: defaultAudioTrackIndex ?? 0,
      filenameOutput
    }
  });
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
      filename: downloadFilename,
      data: output
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
    data: output,
    filenameOutput: downloadFilename,
    recentContext: buildRecentContext({
      item,
      extras: {
        videoMimeType,
        audioMimeType
      }
    })
  });
  await reportProgress({
    videoId,
    progress: 1,
    progressType: ProgressType.FFmpeg,
    tabId
  });
}
