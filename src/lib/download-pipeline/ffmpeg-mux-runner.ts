import { triggerDownload, reportProgress } from ".";
import type { AudioTrackFile, SubtitleFile } from "./ffmpeg-args-builder";
import { buildFfmpegArgs } from "./ffmpeg-args-builder";
import { getFFmpeg } from "./ffmpeg-instance";
import { addToPlaylistBundle } from "./playlist-bundle";
import { ProgressType } from "@/types";
import type { ProcessStreamData } from "@/types";

export async function saveOutput({ item, ffmpegOutput, downloadFilename, filenameOutput, tabId, videoId }: {
  item: ProcessStreamData;
  ffmpegOutput: Uint8Array;
  downloadFilename: string;
  filenameOutput: string;
  tabId: number;
  videoId: string;
}) {
  if (item.playlistId) {
    await addToPlaylistBundle({
      playlistId: item.playlistId,
      playlistTitle: item.playlistTitle ?? "Playlist",
      totalCount: item.playlistTotalCount ?? 1,
      tabId,
      filename: downloadFilename,
      data: ffmpegOutput
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
    data: ffmpegOutput,
    filenameOutput: downloadFilename,
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

export function runFfmpegMux({
  videoFilename, primaryAudioFilename, extraAudioTracks, subtitleFiles,
  outputFilename, outputExtension, audioMimeType, item
}: {
  videoFilename: string;
  primaryAudioFilename: string;
  extraAudioTracks: AudioTrackFile[];
  subtitleFiles: SubtitleFile[];
  outputFilename: string;
  outputExtension: string;
  audioMimeType: string;
  item: ProcessStreamData;
}): Uint8Array {
  const ffmpeg = getFFmpeg();
  const ffmpegArgs = buildFfmpegArgs({
    videoFilename,
    primaryAudioFilename,
    extraAudioTracks,
    subtitleFiles,
    outputFilename,
    outputExtension,
    audioMimeType,
    primaryAudioLabel: item.primaryAudioLabel ?? "",
    additionalAudioLabels: extraAudioTracks.map(track => track.label)
  });

  const exitCode = ffmpeg.exec(...ffmpegArgs);
  if (exitCode !== 0) {
    throw new Error(`FFmpeg exited with code ${exitCode}`);
  }

  const output = ffmpeg.FS.readFile(outputFilename, { encoding: "binary" });
  if (typeof output === "string") {
    throw new Error("FFmpeg readFile returned unexpected string output");
  }

  return output;
}
