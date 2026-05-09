import { toUint8Array, triggerDownload, reportProgress } from ".";
import { getFFmpeg, progressHandlers, tryUnlink } from "./ffmpeg-instance";
import { addToPlaylistBundle } from "./playlist-bundle";
import { getCompatibleFilename } from "@/lib/utils/containers";
import { ProgressType } from "@/types";
import type { ProcessStreamData } from "@/types";

// H.264+Opus → MP4 requires Opus→AAC transcode (FFmpeg's built-in aac encoder).
// Every other container/codec pairing is handled by stream copy.
function resolveAudioCodec(audioMimeType: string, targetExtension: string) {
  if (targetExtension === "mp4" && audioMimeType.includes("webm")) {
    return "aac";
  }

  return "copy";
}

export async function processVideoAudio(item: ProcessStreamData, isCancelled: () => boolean) {
  const {
    videoId, filenameOutput, videoMimeType, audioMimeType, tabId, additionalAudioStreams
  } = item;

  const videoExtension = videoMimeType.includes("webm") ? "webm" : "mp4";
  const audioExtension = audioMimeType.includes("webm") ? "webm" : "m4a";
  const isExtraTracksPresent = Boolean(additionalAudioStreams.length);
  const filenameBase = filenameOutput.replace(/\.[^.]+$/, "");
  const targetExtension = isExtraTracksPresent ? "mkv" : (filenameOutput.split(".").pop() ?? "mkv");
  const needsTranscode = targetExtension !== "mkv";
  const downloadFilename = `${filenameBase}.${targetExtension}`;
  const videoFilename = `${videoId}-video.${videoExtension}`;
  const primaryAudioFilename = `${videoId}-audio.${audioExtension}`;
  const muxFilename = getCompatibleFilename(`${videoId}-mux.mkv`);
  const outputFilename = needsTranscode
    ? getCompatibleFilename(`${videoId}-${downloadFilename}`)
    : muxFilename;
  const ffmpeg = getFFmpeg();

  const ffmpegProgressCapBeforeSave = 0.99;
  let progressOffset = 0;
  let progressScale = needsTranscode ? 0.5 : 1;

  function handleFFmpegProgress({ progress }: { progress: number }) {
    const scaled = progressOffset + progress * progressScale;
    const cappedProgress = Math.min(scaled, ffmpegProgressCapBeforeSave);
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

    ffmpegArgs.push(muxFilename);

    const muxExitCode = ffmpeg.exec(...ffmpegArgs);
    if (muxExitCode !== 0) {
      throw new Error(`FFmpeg exited with code ${muxExitCode}`);
    }

    if (needsTranscode) {
      progressOffset = 0.5;
      progressScale = 0.5;
      const audioCodec = resolveAudioCodec(audioMimeType, targetExtension);
      const transcodeExitCode = ffmpeg.exec("-i", muxFilename, "-c:v", "copy", "-c:a", audioCodec, outputFilename);
      if (transcodeExitCode !== 0) {
        throw new Error(`FFmpeg exited with code ${transcodeExitCode}`);
      }
    }

    if (isCancelled()) {
      return;
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
      filename: muxFilename
    });

    if (needsTranscode) {
      tryUnlink({
        ffmpeg,
        filename: outputFilename
      });
    }

    for (const { filename } of extraAudioTracks) {
      tryUnlink({
        ffmpeg,
        filename
      });
    }
  }
}
