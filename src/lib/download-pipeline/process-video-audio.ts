import { toUint8Array, triggerDownload } from ".";
import { reportProgress } from ".";
import { getCompatibleFilename, getOutputExtension } from "../containers";
import { getFFmpeg, progressHandlers } from "./ffmpeg-instance";
import { addToPlaylistBundle } from "./playlist-bundle";
import { ProgressType } from "@/types";
import type { ProcessStreamData } from "@/types";

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

  const videoExtension = videoMimeType.includes("webm") ? "webm" : "mp4";
  const audioExtension = audioMimeType.includes("webm") ? "webm" : "m4a";
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

  function handleFFmpegProgress({ progress }: { progress: number }) {
    const cappedProgress = Math.min(progress, ffmpegProgressCap);
    void reportProgress({ videoId, progress: cappedProgress, progressType: ProgressType.FFmpeg, tabId });
  }

  progressHandlers.add(handleFFmpegProgress);

  try {
    ffmpeg.FS.writeFile(videoFilename, videoData);
    ffmpeg.FS.writeFile(primaryAudioFilename, audioData);

    const extraAudioEntries = additionalAudioStreams
      .map((stream, i) => {
        const extraData = toUint8Array(stream.data);
        if (!extraData) {
          return null;
        }

        const isExtraWebm = stream.mimeType.includes("webm");
        const extraExtension = isExtraWebm ? "webm" : "m4a";
        return { filename: `${videoId}-audio-extra-${i}.${extraExtension}`, data: extraData };
      })
      .filter(entry => entry !== null);

    for (const entry of extraAudioEntries) {
      ffmpeg.FS.writeFile(entry.filename, entry.data);
    }

    const extraAudioFilenames = extraAudioEntries.map(entry => entry.filename);
    const ffmpegArgs = ["-i", videoFilename, "-i", primaryAudioFilename];
    for (const extraFilename of extraAudioFilenames) {
      ffmpegArgs.push("-i", extraFilename);
    }

    ffmpegArgs.push("-map", "0:v:0");
    for (let i = 0; i <= extraAudioFilenames.length; i++) {
      ffmpegArgs.push("-map", `${i + 1}:a:0`);
    }

    ffmpegArgs.push("-c:v", "copy", "-c:a", "copy");

    const audioTrackLabels = [
      item.primaryAudioLabel ?? "",
      ...additionalAudioStreams.slice(0, extraAudioFilenames.length).map(stream => stream.label)
    ];

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

    for (const file of [videoFilename, primaryAudioFilename, outputFilename, ...extraAudioFilenames]) {
      ffmpeg.FS.unlink(file);
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
  }
}
