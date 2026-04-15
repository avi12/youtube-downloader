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
  return getOutputExtension(videoMimeType, audioMimeType, userExtension);
}

export async function processVideoAudio(item: ProcessStreamData) {
  const {
    videoId, filenameOutput, videoMimeType, audioMimeType, tabId, additionalAudioStreams
  } = item;

  const videoExtension = /webm/.test(videoMimeType) ? "webm" : "mp4";
  const audioExtension = /webm/.test(audioMimeType) ? "webm" : "m4a";
  const isExtraTracksPresent = Boolean(additionalAudioStreams.length);
  const outputExtension = determineOutputExtension({
    videoMimeType, audioMimeType, isExtraTracksPresent, filenameOutput
  });

  const filenameBase = filenameOutput.replace(/\.[^.]+$/, "");
  const downloadFilename = `${filenameBase}.${outputExtension}`;
  const videoFilename = `${videoId}-video.${videoExtension}`;
  const primaryAudioFilename = `${videoId}-audio.${audioExtension}`;
  const outputFilename = getCompatibleFilename(`${videoId}-${downloadFilename}`);
  const ffmpeg = getFFmpeg();

  // progress=1 is reserved for after the file is actually saved to disk (not just after FFmpeg muxing completes).
  const ffmpegProgressCap = 0.99;

  function handleFFmpegProgress({ progress }: {
    progress: number;
  }) {
    const cappedProgress = Math.min(progress, ffmpegProgressCap);
    void reportProgress({ videoId, progress: cappedProgress, progressType: ProgressType.FFmpeg, tabId });
  }

  progressHandlers.add(handleFFmpegProgress);

  // Populated inside try so finally can enumerate filenames for cleanup.
  const extraAudioTracks: {
    filename: string;
    label: string;
  }[] = [];

  try {
    // Block scope: videoData and audioData go out of scope at the closing brace,
    // releasing the JS references before ffmpeg.exec runs — no mutation needed.
    {
      const videoData = toUint8Array(item.videoData);
      const audioData = toUint8Array(item.audioData);
      if (!videoData || !audioData) {
        await reportProgress({ videoId, progress: 1, progressType: ProgressType.FFmpeg, tabId });
        const recentContext = {
          videoId,
          title: item.metadata?.title ?? filenameOutput,
          channel: item.metadata?.artist ?? "",
          thumbnailUrl: item.metadata?.thumbnailUrl
        };
        if (videoData) {
          await triggerDownload(videoData, filenameOutput, recentContext);
        } else if (audioData) {
          await triggerDownload(audioData, filenameOutput, recentContext);
        }

        return;
      }

      await reportProgress({ videoId, progress: 0, progressType: ProgressType.FFmpeg, tabId });
      ffmpeg.FS.writeFile(videoFilename, videoData);
      ffmpeg.FS.writeFile(primaryAudioFilename, audioData);
    }

    // const extraData is iteration-scoped: each binding expires at the loop's closing brace.
    for (const [i, stream] of additionalAudioStreams.entries()) {
      const extraData = toUint8Array(stream.data);
      if (!extraData) {
        continue;
      }

      const extraExtension = /webm/.test(stream.mimeType) ? "webm" : "m4a";
      const extraFilename = `${videoId}-audio-extra-${i}.${extraExtension}`;
      ffmpeg.FS.writeFile(extraFilename, extraData);
      extraAudioTracks.push({ filename: extraFilename, label: stream.label });
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
      await reportProgress({ videoId, progress: 1, progressType: ProgressType.FFmpeg, tabId });
      addToPlaylistBundle({
        playlistId: item.playlistId,
        playlistTitle: item.playlistTitle ?? "Playlist",
        totalCount: item.playlistTotalCount ?? 1,
        tabId,
        filename: downloadFilename,
        data: ffmpegOutput
      });
      return;
    }

    await triggerDownload(ffmpegOutput, downloadFilename, {
      videoId,
      title: item.metadata?.title ?? filenameOutput,
      channel: item.metadata?.artist ?? "",
      thumbnailUrl: item.metadata?.thumbnailUrl
    });
    await reportProgress({ videoId, progress: 1, progressType: ProgressType.FFmpeg, tabId });
  } finally {
    progressHandlers.delete(handleFFmpegProgress);
    tryUnlink(ffmpeg, videoFilename);
    tryUnlink(ffmpeg, primaryAudioFilename);
    tryUnlink(ffmpeg, outputFilename);
    for (const { filename } of extraAudioTracks) {
      tryUnlink(ffmpeg, filename);
    }
  }
}
