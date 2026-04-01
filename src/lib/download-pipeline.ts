/**
 * Download pipeline - runs in the Chrome offscreen document or Firefox background.
 *
 * Receives raw video/audio bytes (already fetched via SABR in the MAIN world
 * content script) and either muxes them with FFmpeg (video+audio) or triggers
 * a browser download directly (single stream). Supports unlimited concurrent
 * FFmpeg jobs, each with its own instance that can be independently cancelled.
 */

import { sendMessage } from "./messaging";
import { getCompatibleFilename, getMimeType } from "./utils";
import type { DownloadType, ProcessStreamData, ProgressType } from "@/types";
import { FFmpeg } from "@ffmpeg/ffmpeg";

// ─── FFmpeg configuration ────────────────────────────────────────────────────

let ffmpegUrls: { coreURL: string; wasmURL: string; classWorkerURL: string } | null = null;

export function initFFmpeg(coreURL: string, wasmURL: string, classWorkerURL: string) {
  ffmpegUrls = { coreURL, wasmURL, classWorkerURL };
  sendMessage("pipelineFFmpegReady", {});
}

async function createFFmpegInstance() {
  if (!ffmpegUrls) {
    throw new Error("initFFmpeg() must be called before processing video+audio downloads");
  }

  const instance = new FFmpeg();
  await instance.load(ffmpegUrls);
  return instance;
}

// ─── Active jobs ─────────────────────────────────────────────────────────────

interface ActiveJob {
  ffmpeg: FFmpeg | null;
  videoId: string;
  tabId: number;
}

const activeJobs = new Map<string, ActiveJob>();
const downloadQueue: ProcessStreamData[] = [];

// ─── Progress reporting ──────────────────────────────────────────────────────

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

// ─── Single-stream download (audio-only or video-only) ──────────────────────

function toUint8Array(data: Uint8Array | null) {
  if (!data) {
    return null;
  }

  if (!(data instanceof Uint8Array)) {
    return new Uint8Array(Object.values(data));
  }

  return data;
}

async function triggerDownload(data: Uint8Array, filenameOutput: string) {
  const mimeType = getMimeType(filenameOutput);
  const filename = getCompatibleFilename(filenameOutput);
  const blob = new Blob([new Uint8Array(data)], { type: mimeType });
  const blobUrl = URL.createObjectURL(blob);

  await sendMessage("pipelineDownload", { blobUrl, mimeType, filename });

  setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
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

  await reportProgress(videoId, 0.99, type === "audio" ? "audio" : "video", tabId);
  await triggerDownload(data, filenameOutput);
}

// ─── Video + audio mux via FFmpeg ────────────────────────────────────────────

function determineOutputExtension(
  isVideoWebm: boolean,
  isAudioWebm: boolean,
  hasExtraTracks: boolean,
  filenameOutput: string
) {
  if (hasExtraTracks) {
    return "mkv";
  }

  if (isVideoWebm && isAudioWebm) {
    return "webm";
  }

  if (!isVideoWebm && !isAudioWebm) {
    return filenameOutput.split(".").pop() ?? "mp4";
  }

  return "mkv";
}

async function processVideoAudio(item: ProcessStreamData, ffmpeg: FFmpeg) {
  const {
    videoId, filenameOutput,
    videoMimeType, audioMimeType, tabId,
    additionalAudioStreams
  } = item;
  const videoData = toUint8Array(item.videoData);
  const audioData = toUint8Array(item.audioData);
  if (!videoData || !audioData) {
    if (videoData) {
      await triggerDownload(videoData, filenameOutput);
    } else if (audioData) {
      await triggerDownload(audioData, filenameOutput);
    }

    return;
  }

  await reportProgress(videoId, 0.5, "video", tabId);

  const isVideoWebm = videoMimeType.includes("webm");
  const isAudioWebm = audioMimeType.includes("webm");
  const videoExtension = isVideoWebm ? "webm" : "mp4";
  const audioExtension = isAudioWebm ? "webm" : "m4a";
  const hasExtraTracks = (additionalAudioStreams?.length ?? 0) > 0;
  const outputExtension = determineOutputExtension(isVideoWebm, isAudioWebm, hasExtraTracks, filenameOutput);

  const filenameBase = filenameOutput.replace(/\.[^.]+$/, "");
  const downloadFilename = `${filenameBase}.${outputExtension}`;
  const videoFilename = `${videoId}-video.${videoExtension}`;
  const primaryAudioFilename = `${videoId}-audio.${audioExtension}`;
  const outputFilename = getCompatibleFilename(`${videoId}-${downloadFilename}`);

  function handleFFmpegProgress({ progress }: { progress: number }) {
    reportProgress(videoId, 0.5 + progress * 0.5, "ffmpeg", tabId);
  }

  ffmpeg.on("progress", handleFFmpegProgress);

  try {
    await ffmpeg.writeFile(videoFilename, videoData);
    await ffmpeg.writeFile(primaryAudioFilename, audioData);

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

    const ffmpegArgs = ["-i", videoFilename, "-i", primaryAudioFilename];
    for (const extraFilename of extraAudioFilenames) {
      ffmpegArgs.push("-i", extraFilename);
    }

    ffmpegArgs.push("-map", "0:v:0");
    for (let iInput = 0; iInput <= extraAudioFilenames.length; iInput++) {
      ffmpegArgs.push("-map", `${iInput + 1}:a:0`);
    }

    ffmpegArgs.push("-c:v", "copy", "-c:a", "copy");

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

    const exitCode = await ffmpeg.exec(ffmpegArgs);
    if (exitCode !== 0) {
      throw new Error(`FFmpeg exited with code ${exitCode}`);
    }

    const ffmpegOutput = await ffmpeg.readFile(outputFilename);
    if (!(ffmpegOutput instanceof Uint8Array)) {
      throw new Error("FFmpeg readFile returned unexpected string output");
    }

    const filesToDelete = [videoFilename, primaryAudioFilename, outputFilename, ...extraAudioFilenames];
    await Promise.all(filesToDelete.map(filename => ffmpeg.deleteFile(filename)));

    await triggerDownload(ffmpegOutput, downloadFilename);
  } finally {
    ffmpeg.off("progress", handleFFmpegProgress);
  }
}

// ─── Job processing ──────────────────────────────────────────────────────────

async function processItem(item: ProcessStreamData) {
  const job: ActiveJob = { ffmpeg: null, videoId: item.videoId, tabId: item.tabId };
  activeJobs.set(item.videoId, job);

  try {
    if (item.type === "video+audio") {
      const ffmpeg = await createFFmpegInstance();
      job.ffmpeg = ffmpeg;

      try {
        await processVideoAudio(item, ffmpeg);
      } finally {
        ffmpeg.terminate();
      }
    } else {
      await processSingleMedia(item);
    }
  } catch (error) {
    console.error("[ytdl:pipeline] Mux/download failed:", item.videoId, error);
  } finally {
    activeJobs.delete(item.videoId);
    await removeFromStorageQueue(item.videoId, item.type);
  }
}

function processQueue() {
  while (downloadQueue.length > 0) {
    const item = downloadQueue.shift()!;
    processItem(item);
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function enqueueStreamData(data: ProcessStreamData) {
  const isDuplicate = downloadQueue.some(item => item.videoId === data.videoId)
    || activeJobs.has(data.videoId);
  if (isDuplicate) {
    return;
  }

  downloadQueue.push(data);
  processQueue();
}

export async function cancelDownloadsByIds(videoIds: string[]) {
  for (const videoId of videoIds) {
    const activeJob = activeJobs.get(videoId);
    if (activeJob) {
      activeJob.ffmpeg?.terminate();
      activeJobs.delete(videoId);
      await reportRemoval(videoId, activeJob.tabId);
      continue;
    }

    const queuedIndex = downloadQueue.findIndex(item => item.videoId === videoId);
    if (queuedIndex >= 0) {
      const [removed] = downloadQueue.splice(queuedIndex, 1);
      await removeFromStorageQueue(videoId, removed.type);
      await reportRemoval(videoId, removed.tabId);
    }
  }
}
