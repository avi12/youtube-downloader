/**
 * Download pipeline - runs in the Chrome offscreen document or Firefox background.
 *
 * Receives raw video/audio bytes (already fetched via SABR in the MAIN world
 * content script) and either muxes them with FFmpeg (video+audio) or triggers
 * a browser download directly (single stream).
 */

import { sendMessage } from "./messaging";
import { getCompatibleFilename, getMimeType } from "./utils";
import type { DownloadType, ProcessStreamData, ProgressType } from "@/types";
import { FFmpeg, type ProgressEventCallback } from "@ffmpeg/ffmpeg";

// ─── FFmpeg singleton ─────────────────────────────────────────────────────────

const ffmpeg = new FFmpeg();
let ffmpegInitPromise: Promise<void> | null = null;

export function initFFmpeg(coreURL: string, wasmURL: string, classWorkerURL: string) {
  if (ffmpegInitPromise) {
    return;
  }

  ffmpegInitPromise = (async () => {
    if (ffmpeg.loaded) {
      return;
    }

    try {
      await ffmpeg.load({ coreURL, wasmURL, classWorkerURL });
      await sendMessage("pipelineFFmpegReady", {});
    } catch (error) {
      console.error("[ytdl:pipeline] FFmpeg load failed:", error);
      throw error;
    }
  })();
}

async function waitForFFmpeg() {
  if (!ffmpegInitPromise) {
    throw new Error("initFFmpeg() must be called before processing video+audio downloads");
  }

  await ffmpegInitPromise;
}

// ─── In-memory queue ─────────────────────────────────────────────────────────

const downloadQueue: ProcessStreamData[] = [];
let isProcessing = false;
let currentProgressHandler: ProgressEventCallback | null = null;

// ─── Progress reporting ───────────────────────────────────────────────────────

async function reportProgress(
  videoId: string,
  progress: number,
  progressType: ProgressType,
  tabId: number
) {
  await sendMessage("pipelineProgress", {
    videoId, progress, progressType, tabId
  });
}

async function reportRemoval(videoId: string, tabId: number) {
  await sendMessage("pipelineRemoval", { videoId, tabId });
}

async function removeFromStorageQueue(videoId: string, type: DownloadType) {
  await sendMessage("pipelineQueueRemove", { videoId, type });
}

// ─── Single-stream download (audio-only or video-only) ───────────────────────

function toUint8Array(data: Uint8Array | null): Uint8Array | null {
  if (!data) {
    return null;
  }

  // Structured clone may deliver Uint8Array as a plain object with numeric keys
  if (!(data instanceof Uint8Array)) {
    return new Uint8Array(Object.values(data));
  }

  return data;
}

async function triggerDownload(data: Uint8Array, filenameOutput: string) {
  // Offscreen documents can't use browser.downloads directly.
  // Encode as base64 and send to background for the actual download.
  let binary = "";
  const chunkSize = 8192;

  for (let offset = 0; offset < data.byteLength; offset += chunkSize) {
    const chunk = data.subarray(offset, Math.min(offset + chunkSize, data.byteLength));
    binary += String.fromCharCode(...chunk);
  }

  await sendMessage("pipelineDownload", {
    blobBase64: btoa(binary),
    mimeType: getMimeType(filenameOutput),
    filename: getCompatibleFilename(filenameOutput)
  });
}

async function processSingleMedia(item: ProcessStreamData) {
  const {
    videoId, type, filenameOutput, videoData, audioData, tabId
  } = item;
  const rawData = type === "audio" ? audioData : videoData;
  const data = toUint8Array(rawData);
  if (!data) {
    return;
  }

  void reportProgress(videoId, 0.99, type === "audio" ? "audio" : "video", tabId);

  await triggerDownload(data, filenameOutput);
}

// ─── Video + audio mux via FFmpeg ─────────────────────────────────────────────

async function processVideoAudio(item: ProcessStreamData) {
  const {
    videoId, filenameOutput,
    videoMimeType, audioMimeType, tabId,
    additionalAudioStreams
  } = item;
  const videoData = toUint8Array(item.videoData);
  const audioData = toUint8Array(item.audioData);

  console.log("[ytdl:pipeline] processVideoAudio: video=", videoData?.byteLength, "audio=", audioData?.byteLength, "extra tracks:", additionalAudioStreams?.length ?? 0);

  if (!videoData || !audioData) {
    console.log("[ytdl:pipeline] Missing data, falling back to single media");

    if (videoData) {
      await triggerDownload(videoData, filenameOutput);
    } else if (audioData) {
      await triggerDownload(audioData, filenameOutput);
    }

    return;
  }

  await waitForFFmpeg();

  void reportProgress(videoId, 0.5, "video", tabId);

  const isVideoWebm = videoMimeType.includes("webm");
  const isAudioWebm = audioMimeType.includes("webm");
  const videoExtension = isVideoWebm ? "webm" : "mp4";
  const audioExtension = isAudioWebm ? "webm" : "m4a";
  const hasExtraTracks = (additionalAudioStreams?.length ?? 0) > 0;

  // Pick the output container based on codec compatibility and track count:
  // - Multiple audio tracks → .mkv (best multi-track support)
  // - WebM+WebM → .webm (VP9/Opus native container)
  // - MP4+MP4   → keep user's chosen extension (H.264/AAC native)
  // - Mixed     → .mkv (Matroska supports all codec combinations)
  let outputExtension: string;
  if (hasExtraTracks) {
    outputExtension = "mkv";
  } else if (isVideoWebm && isAudioWebm) {
    outputExtension = "webm";
  } else if (!isVideoWebm && !isAudioWebm) {
    outputExtension = filenameOutput.split(".").pop() ?? "mp4";
  } else {
    outputExtension = "mkv";
  }

  const filenameBase = filenameOutput.replace(/\.[^.]+$/, "");
  const downloadFilename = `${filenameBase}.${outputExtension}`;

  const videoFilename = `${videoId}-video.${videoExtension}`;
  const primaryAudioFilename = `${videoId}-audio.${audioExtension}`;
  const outputFilename = getCompatibleFilename(`${videoId}-${downloadFilename}`);
  if (currentProgressHandler) {
    ffmpeg.off("progress", currentProgressHandler);
  }

  currentProgressHandler = ({ progress }) => {
    void reportProgress(videoId, 0.5 + progress * 0.5, "ffmpeg", tabId);
  };

  ffmpeg.on("progress", currentProgressHandler);

  console.log(`[ytdl:pipeline] Writing ${videoFilename} (${videoData.byteLength}b) and ${primaryAudioFilename} (${audioData.byteLength}b)`);
  try {
    await ffmpeg.writeFile(videoFilename, videoData);
    console.log("[ytdl:pipeline] Video file written OK");
  } catch (writeError) {
    console.error("[ytdl:pipeline] Failed to write video file:", writeError);
    throw writeError;
  }

  try {
    await ffmpeg.writeFile(primaryAudioFilename, audioData);
    console.log("[ytdl:pipeline] Audio file written OK");
  } catch (writeError) {
    console.error("[ytdl:pipeline] Failed to write audio file:", writeError);
    throw writeError;
  }

  // Write additional audio tracks and build FFmpeg input args
  const extraAudioFilenames: string[] = [];
  for (let iTrack = 0; iTrack < (additionalAudioStreams?.length ?? 0); iTrack++) {
    const stream = additionalAudioStreams![iTrack];
    const extraData = toUint8Array(stream.data);
    if (!extraData) {
      continue;
    }

    const isExtraWebm = stream.mimeType.includes("webm");
    const extraExtension = isExtraWebm ? "webm" : "m4a";
    const extraFilename = `${videoId}-audio-extra-${iTrack}.${extraExtension}`;
    await ffmpeg.writeFile(extraFilename, extraData);
    extraAudioFilenames.push(extraFilename);
  }

  // Build FFmpeg command: video input + primary audio + all extra audio inputs.
  const ffmpegArgs = ["-i", videoFilename, "-i", primaryAudioFilename];
  for (const extraFilename of extraAudioFilenames) {
    ffmpegArgs.push("-i", extraFilename);
  }

  // Map video stream, then all audio streams (primary + extras)
  ffmpegArgs.push("-map", "0:v:0");
  for (let iInput = 0; iInput <= extraAudioFilenames.length; iInput++) {
    ffmpegArgs.push("-map", `${iInput + 1}:a:0`);
  }

  ffmpegArgs.push("-c:v", "copy", "-c:a", "copy");

  // Set human-readable titles for each audio track so VLC shows language names
  const audioTrackLabels = [
    item.primaryAudioLabel ?? "",
    ...(additionalAudioStreams ?? []).slice(0, extraAudioFilenames.length).map(stream => stream.label)
  ];
  for (let iTrack = 0; iTrack < audioTrackLabels.length; iTrack++) {
    const label = audioTrackLabels[iTrack];
    if (label) {
      ffmpegArgs.push(`-metadata:s:a:${iTrack}`, `title=${label}`);
    }
  }

  ffmpegArgs.push(outputFilename);

  // Capture FFmpeg log output for debugging
  const ffmpegLogs: string[] = [];
  function onLog({ message }: { message: string }) {
    ffmpegLogs.push(message);
  }

  ffmpeg.on("log", onLog);
  console.log("[ytdl:pipeline] FFmpeg args:", ffmpegArgs.join(" "));
  const exitCode = await ffmpeg.exec(ffmpegArgs);
  ffmpeg.off("log", onLog);
  console.log("[ytdl:pipeline] FFmpeg exit code:", exitCode);

  if (exitCode !== 0) {
    console.error("[ytdl:pipeline] FFmpeg logs:", ffmpegLogs.join("\n"));
    throw new Error(`FFmpeg exited with code ${exitCode}`);
  }

  const ffmpegOutput = await ffmpeg.readFile(outputFilename);
  if (!(ffmpegOutput instanceof Uint8Array)) {
    throw new Error("FFmpeg readFile returned unexpected string output");
  }

  const filesToDelete = [videoFilename, primaryAudioFilename, outputFilename, ...extraAudioFilenames];
  await Promise.all(filesToDelete.map(filename => ffmpeg.deleteFile(filename)));

  await triggerDownload(ffmpegOutput, downloadFilename);
}

// ─── Queue processor ──────────────────────────────────────────────────────────

async function processQueue() {
  if (isProcessing) {
    return;
  }

  isProcessing = true;

  while (downloadQueue.length > 0) {
    const item = downloadQueue[0];

    try {
      if (item.type === "video+audio") {
        await processVideoAudio(item);
      } else {
        await processSingleMedia(item);
      }
    } catch (error) {
      console.error("[ytdl:pipeline] Mux/download failed:", item.videoId, error);
    }

    downloadQueue.shift();
    await removeFromStorageQueue(item.videoId, item.type);
  }

  isProcessing = false;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function enqueueStreamData(data: ProcessStreamData) {
  if (downloadQueue.some(item => item.videoId === data.videoId)) {
    return;
  }

  downloadQueue.push(data);
  processQueue();
}

export async function cancelDownloadsByIds(videoIds: string[]) {
  for (const videoId of videoIds) {
    const queuedIndex = downloadQueue.findIndex(
      (item, iItem) => item.videoId === videoId && iItem > 0
    );
    if (queuedIndex > 0) {
      const [removed] = downloadQueue.splice(queuedIndex, 1);
      await removeFromStorageQueue(videoId, removed.type);
      await reportRemoval(videoId, removed.tabId);
    }
  }
}
