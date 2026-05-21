import { toUint8Array, reportProgress, toOwnedArrayBuffer, buildRecentContext } from ".";
import { triggerDownloadFromFile } from "./blob-download";
import {
  buildExtraAudioTracks,
  buildSubtitleFiles,
  handleSingleStream,
  resolveDownloadFilename
} from "./build-mux-job";
import { runMuxVideoAudio } from "./ffmpeg-instance";
import { addToPlaylistBundle } from "./playlist-bundle";
import { OPFS_MUX_OUTPUT_SUFFIX } from "@/entrypoints/mux-worker/opfs-output-fs";
import { ProgressType } from "@/types";
import type { ProcessStreamData } from "@/types";

const DEFAULT_PLAYLIST_TITLE = "Playlist";

type ProcessVideoAudioParams = {
  item: ProcessStreamData;
  isCancelled: () => boolean;
};
export async function processVideoAudio({ item, isCancelled }: ProcessVideoAudioParams) {
  const {
    videoId, filenameOutput, videoMimeType, audioMimeType, tabId,
    additionalAudioStreams, subtitleTracks, primaryAudioLanguageCode, defaultAudioTrackIndex
  } = item;

  const videoData = item.videoFile ? null : toUint8Array(item.videoData);
  const audioData = toUint8Array(item.audioData);
  const isVideoMissing = !videoData && !item.videoFile;
  const isMissingStream = isVideoMissing || !audioData;
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

  const outputFile = await runMuxVideoAudio({
    videoId,
    job: {
      videoData: item.videoFile ? null : toOwnedArrayBuffer(videoData!),
      videoFile: item.videoFile,
      audioData: toOwnedArrayBuffer(audioData!),
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
  const hasVideoFile = Boolean(item.videoFile);
  if (hasVideoFile) {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry(item.videoFile!.name).catch(() => {});
  }

  const isDownloadCancelled = isCancelled();
  if (isDownloadCancelled) {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry(videoId + OPFS_MUX_OUTPUT_SUFFIX).catch(() => {});
    return;
  }

  const isPlaylistItem = Boolean(item.playlistId);
  if (isPlaylistItem) {
    const data = new Uint8Array(await outputFile.arrayBuffer());
    const root = await navigator.storage.getDirectory();
    await root.removeEntry(videoId + OPFS_MUX_OUTPUT_SUFFIX).catch(() => {});
    await addToPlaylistBundle({
      playlistId: item.playlistId!,
      playlistTitle: item.playlistTitle ?? DEFAULT_PLAYLIST_TITLE,
      totalCount: item.playlistTotalCount ?? 1,
      tabId,
      filename: downloadFilename,
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

  await triggerDownloadFromFile({
    file: outputFile,
    filenameOutput: downloadFilename,
    recentContext: buildRecentContext({
      item,
      extras: {
        videoMimeType,
        audioMimeType
      }
    }),
    async onRevoke() {
      const root = await navigator.storage.getDirectory();
      await root.removeEntry(videoId + OPFS_MUX_OUTPUT_SUFFIX).catch(() => {});
    }
  });
  await reportProgress({
    videoId,
    progress: 1,
    progressType: ProgressType.FFmpeg,
    tabId
  });
}
