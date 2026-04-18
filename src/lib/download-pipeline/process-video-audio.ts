import { toUint8Array, triggerDownload, reportProgress } from ".";
import { getFFmpeg, progressHandlers, tryUnlink } from "./ffmpeg-instance";
import { addToPlaylistBundle } from "./playlist-bundle";
import { ProgressType } from "@/types";
import type { ProcessStreamData } from "@/types";
import { getCompatibleFilename, getOutputExtension } from "~/lib/utils/containers";

function determineOutputExtension({
  videoMimeType, audioMimeType, isExtraTracksPresent, filenameOutput
}: {
  videoMimeType: string;
  audioMimeType: string;
  isExtraTracksPresent: boolean;
  filenameOutput: string;
}) {
  if (isExtraTracksPresent) {
    return "mkv";
  }

  const userExtension = filenameOutput.split(".").pop() ?? "mp4";
  return getOutputExtension({
    videoMimeType,
    audioMimeType,
    userExtension
  });
}

export async function processVideoAudio(item: ProcessStreamData) {
  const {
    videoId, filenameOutput, videoMimeType, audioMimeType, tabId, additionalAudioStreams
  } = item;

  const videoExtension = videoMimeType.includes("webm") ? "webm" : "mp4";
  const audioExtension = audioMimeType.includes("webm") ? "webm" : "m4a";
  const isExtraTracksPresent = Boolean(additionalAudioStreams.length);
  const outputExtension = determineOutputExtension({
    videoMimeType,
    audioMimeType,
    isExtraTracksPresent,
    filenameOutput
  });

  const filenameBase = filenameOutput.replace(/\.[^.]+$/, "");
  const downloadFilename = `${filenameBase}.${outputExtension}`;
  const videoFilename = `${videoId}-video.${videoExtension}`;
  const primaryAudioFilename = `${videoId}-audio.${audioExtension}`;
  const outputFilename = getCompatibleFilename(`${videoId}-${downloadFilename}`);
  const ffmpeg = getFFmpeg();

  const ffmpegProgressCapBeforeSave = 0.99;

  function handleFFmpegProgress({ progress }: {
    progress: number;
  }) {
    const cappedProgress = Math.min(progress, ffmpegProgressCapBeforeSave);
    void reportProgress({
      videoId,
      progress: cappedProgress,
      progressType: ProgressType.FFmpeg,
      tabId
    });
  }

  progressHandlers.add(handleFFmpegProgress);

  const extraAudioTracks: {
    filename: string;
    label: string;
  }[] = [];

  try {
    {
      const videoData = toUint8Array(item.videoData);
      const audioData = toUint8Array(item.audioData);
      if (!videoData || !audioData) {
        const recentContext = {
          videoId,
          title: item.metadata?.title ?? filenameOutput,
          channel: item.metadata?.artist ?? "",
          thumbnailUrl: item.metadata?.thumbnailUrl
        };
        if (videoData) {
          await triggerDownload({
            data: videoData,
            filenameOutput,
            recentContext
          });
        } else if (audioData) {
          await triggerDownload({
            data: audioData,
            filenameOutput,
            recentContext
          });
        }

        await reportProgress({
          videoId,
          progress: 1,
          progressType: ProgressType.FFmpeg,
          tabId
        });

        return;
      }

      await reportProgress({
        videoId,
        progress: 0,
        progressType: ProgressType.FFmpeg,
        tabId
      });
      ffmpeg.FS.writeFile(videoFilename, videoData);
      ffmpeg.FS.writeFile(primaryAudioFilename, audioData);
    }

    for (const [i, stream] of additionalAudioStreams.entries()) {
      const extraData = toUint8Array(stream.data);
      if (!extraData) {
        continue;
      }

      const extraExtension = stream.mimeType.includes("webm") ? "webm" : "m4a";
      const extraFilename = `${videoId}-audio-extra-${i}.${extraExtension}`;
      ffmpeg.FS.writeFile(extraFilename, extraData);
      extraAudioTracks.push({
        filename: extraFilename,
        label: stream.label
      });
    }

    const ffmpegArgs = ["-i", videoFilename, "-i", primaryAudioFilename];
    for (const { filename } of extraAudioTracks) {
      ffmpegArgs.push("-i", filename);
    }

    ffmpegArgs.push("-map", "0:v:0");
    for (let i = 0; i <= extraAudioTracks.length; i++) {
      ffmpegArgs.push("-map", `${i + 1}:a:0`);
    }

    ffmpegArgs.push("-c:v", "copy", "-c:a", "copy");

    const audioTrackLabels = [item.primaryAudioLabel ?? "", ...extraAudioTracks.map(track => track.label)];
    for (let i = 0; i < audioTrackLabels.length; i++) {
      const label = audioTrackLabels[i];
      if (label) {
        ffmpegArgs.push(`-metadata:s:a:${i}`, `title=${label}`);
      }
    }

    ffmpegArgs.push(outputFilename);

    const exitCode = ffmpeg.exec(...ffmpegArgs);
    if (exitCode !== 0) {
      throw new Error(`FFmpeg exited with code ${exitCode}`);
    }

    const ffmpegOutput = ffmpeg.FS.readFile(outputFilename, { encoding: "binary" });
    if (typeof ffmpegOutput === "string") {
      throw new Error("FFmpeg readFile returned unexpected string output");
    }

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
  } finally {
    progressHandlers.delete(handleFFmpegProgress);
    tryUnlink({
      ffmpeg,
      filename: videoFilename
    });
    tryUnlink({
      ffmpeg,
      filename: primaryAudioFilename
    });
    tryUnlink({
      ffmpeg,
      filename: outputFilename
    });
    for (const { filename } of extraAudioTracks) {
      tryUnlink({
        ffmpeg,
        filename
      });
    }
  }
}
