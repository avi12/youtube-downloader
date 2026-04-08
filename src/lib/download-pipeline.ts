/**
 * Download pipeline - runs in the Chrome offscreen document or Firefox background.
 *
 * Receives raw video/audio bytes (already fetched via SABR in the MAIN world
 * content script) and either muxes them with FFmpeg (video+audio) or triggers
 * a browser download directly (single stream). Supports unlimited concurrent
 * FFmpeg jobs, each with its own instance that can be independently cancelled.
 */

import { MessageType, sendMessage } from "./messaging";
import {
  getCompatibleFilename,
  getFileExtension,
  getMimeType,
  getOutputExtension,
  uint8ToBase64
} from "./utils";
import { ProgressType } from "@/types";
import { DownloadType } from "@/types";
import type { ProcessStreamData, VideoMetadata } from "@/types";
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { zipSync } from "fflate";

// ─── FFmpeg configuration ────────────────────────────────────────────────────
// A single FFmpeg instance is reused across all mux jobs. WASM can only run one
// exec() at a time, so mux operations are serialized via a queue while downloads
// still run in parallel.

let ffmpegUrls: {
  coreURL: string;
  wasmURL: string;
  classWorkerURL: string;
} | null = null;
let sharedFFmpeg: FFmpeg | null = null;

export function initFFmpeg({ coreURL, wasmURL, classWorkerURL }: {
  coreURL: string;
  wasmURL: string;
  classWorkerURL: string;
}) {
  ffmpegUrls = {
    coreURL,
    wasmURL,
    classWorkerURL
  };
  void sendMessage(MessageType.PipelineFFmpegReady, {});
}

async function getFFmpegInstance() {
  if (!ffmpegUrls) {
    throw new Error("initFFmpeg() must be called before processing video+audio downloads");
  }

  if (!sharedFFmpeg) {
    sharedFFmpeg = new FFmpeg();
    await sharedFFmpeg.load(ffmpegUrls);
  }

  return sharedFFmpeg;
}

// ─── Mux queue (serialized FFmpeg exec) ─────────────────────────────────────

const muxQueue: (() => Promise<void>)[] = [];
let isMuxing = false;

async function processMuxQueue() {
  if (isMuxing) {
    return;
  }

  isMuxing = true;

  while (muxQueue.length > 0) {
    const job = muxQueue.shift()!;
    await job();
  }

  isMuxing = false;
}

function enqueueMuxJob(job: () => Promise<void>) {
  return new Promise<void>((resolve, reject) => {
    muxQueue.push(async () => {
      try {
        await job();
        resolve();
      } catch (error) {
        reject(error);
      }
    });
    void processMuxQueue();
  });
}

// ─── Active jobs ─────────────────────────────────────────────────────────────

interface ActiveJob {
  ffmpeg: FFmpeg | null;
  videoId: string;
  tabId: number;
}

const activeJobs = new Map<string, ActiveJob>();

// ─── Progress reporting ──────────────────────────────────────────────────────

async function reportProgress({
  videoId, progress, progressType, tabId
}: {
  videoId: string;
  progress: number;
  progressType: ProgressType;
  tabId: number;
}) {
  await sendMessage(MessageType.PipelineProgress, {
    videoId,
    progress,
    progressType,
    tabId
  });
}

async function reportRemoval(videoId: string, tabId: number) {
  await sendMessage(MessageType.PipelineRemoval, {
    videoId,
    tabId
  });
}

async function removeFromStorageQueue(videoId: string, type: DownloadType) {
  await sendMessage(MessageType.PipelineQueueRemove, {
    videoId,
    type
  });
}

// ─── Single-stream download (audio-only or video-only) ──────────────────────

function toUint8Array(data: Uint8Array | Record<string, number> | null) {
  if (!data) {
    return null;
  }

  if (!ArrayBuffer.isView(data)) {
    return new Uint8Array(Object.values(data));
  }

  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

async function triggerDownload(data: Uint8Array, filenameOutput: string) {
  const mimeType = getMimeType(filenameOutput) || "application/octet-stream";
  const filename = getCompatibleFilename(filenameOutput);
  // Chrome offscreen document has Blob + URL.createObjectURL.
  // Firefox service worker does not, so fall back to base64 data URL.
  try {
    const blob = new Blob([new Uint8Array(data)], { type: mimeType });
    const blobUrl = URL.createObjectURL(blob);
    await sendMessage(MessageType.PipelineDownload, {
      blobUrl,
      mimeType,
      filename
    });
    await new Promise(resolve => setTimeout(resolve, 60_000));
    URL.revokeObjectURL(blobUrl);
  } catch {
    const blobUrl = `data:${mimeType};base64,${uint8ToBase64(data)}`;
    await sendMessage(MessageType.PipelineDownload, {
      blobUrl,
      mimeType,
      filename
    });
  }
}
// ─── Playlist zip bundling ───────────────────────────────────────────────────

interface PlaylistBundle {
  playlistTitle: string;
  totalCount: number;
  files: Map<string, {
    filename: string;
    data: Uint8Array;
  }>;
  tabId: number;
}

const playlistBundles = new Map<string, PlaylistBundle>();

function addToPlaylistBundle({
  playlistId, playlistTitle, totalCount, tabId, filename, data
}: {
  playlistId: string;
  playlistTitle: string;
  totalCount: number;
  tabId: number;
  filename: string;
  data: Uint8Array;
}) {
  if (!playlistBundles.has(playlistId)) {
    playlistBundles.set(playlistId, {
      playlistTitle,
      totalCount,
      files: new Map(),
      tabId
    });
  }

  const bundle = playlistBundles.get(playlistId)!;
  bundle.files.set(filename, {
    filename,
    data
  });

  if (bundle.files.size < bundle.totalCount) {
    return;
  }

  // All files collected - create zip
  const zipEntries: Record<string, Uint8Array> = {};
  for (const [, file] of bundle.files) {
    zipEntries[file.filename] = file.data;
  }

  const zipped = zipSync(zipEntries);
  const zipFilename = getCompatibleFilename(`${bundle.playlistTitle}.zip`);
  playlistBundles.delete(playlistId);

  void triggerDownload(zipped, zipFilename);
}

async function fetchThumbnail(url: string) {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return null;
    }

    return new Uint8Array(await response.arrayBuffer());
  } catch {
    return null;
  }
}

async function embedMusicMetadata(
  audioData: Uint8Array,
  filenameOutput: string,
  metadata: VideoMetadata,
  ffmpeg: FFmpeg
) {
  const audioExtension = getFileExtension(filenameOutput) || "m4a";
  const inputFilename = `input.${audioExtension}`;
  const outputFilename = getCompatibleFilename(filenameOutput);

  await ffmpeg.writeFile(inputFilename, audioData);

  const ffmpegArgs = ["-i", inputFilename];

  // Download and attach thumbnail as cover art
  let hasCoverArt = false;
  if (metadata.thumbnailUrl) {
    const thumbnailData = await fetchThumbnail(metadata.thumbnailUrl);
    if (thumbnailData) {
      await ffmpeg.writeFile("cover.jpg", thumbnailData);
      ffmpegArgs.push("-i", "cover.jpg");
      hasCoverArt = true;
    }
  }

  ffmpegArgs.push("-map", "0:a");

  if (hasCoverArt) {
    ffmpegArgs.push("-map", "1:v");
    ffmpegArgs.push("-c:v", "mjpeg");
    ffmpegArgs.push("-disposition:v", "attached_pic");
  }

  ffmpegArgs.push("-c:a", "copy");
  ffmpegArgs.push("-metadata", `title=${metadata.title}`);
  ffmpegArgs.push("-metadata", `artist=${metadata.artist}`);

  if (metadata.date) {
    ffmpegArgs.push("-metadata", `date=${metadata.date}`);
  }

  ffmpegArgs.push(outputFilename);

  const exitCode = await ffmpeg.exec(ffmpegArgs);
  if (exitCode !== 0) {
    // Fallback: return original data without tags
    await ffmpeg.deleteFile(inputFilename);
    return audioData;
  }

  const taggedOutput = await ffmpeg.readFile(outputFilename);
  await ffmpeg.deleteFile(inputFilename);
  await ffmpeg.deleteFile(outputFilename);

  if (hasCoverArt) {
    await ffmpeg.deleteFile("cover.jpg");
  }

  if (typeof taggedOutput === "string") {
    return audioData;
  }

  return taggedOutput;
}

async function processSingleMedia(item: ProcessStreamData) {
  const {
    videoId, type, filenameOutput, videoData, audioData, tabId
  } = item;
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

  // Embed ID3 tags and cover art for music downloads
  if (type === DownloadType.Audio && item.metadata?.isMusic) {
    await reportProgress({
      videoId,
      progress: 0.5,
      progressType: ProgressType.FFmpeg,
      tabId
    });

    await enqueueMuxJob(async () => {
      const ffmpeg = await getFFmpegInstance();
      data = await embedMusicMetadata(data!, filenameOutput, item.metadata!, ffmpeg);
    });

    await reportProgress({
      videoId,
      progress: 1,
      progressType: ProgressType.FFmpeg,
      tabId
    });
  }

  if (item.playlistId) {
    addToPlaylistBundle({
      playlistId: item.playlistId,
      playlistTitle: item.playlistTitle ?? "Playlist",
      totalCount: item.playlistTotalCount ?? 1,
      tabId,
      filename: filenameOutput,
      data
    });
    return;
  }

  await triggerDownload(data, filenameOutput);
}

// ─── Video + audio mux via FFmpeg ────────────────────────────────────────────

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

  await reportProgress({
    videoId,
    progress: 0.5,
    progressType: ProgressType.Video,
    tabId
  });

  const videoExtension = videoMimeType.includes("webm") ? "webm" : "mp4";
  const audioExtension = audioMimeType.includes("webm") ? "webm" : "m4a";
  const isExtraTracksPresent = (additionalAudioStreams?.length ?? 0) > 0;
  const outputExtension = determineOutputExtension({
    videoMimeType, audioMimeType, isExtraTracksPresent, filenameOutput
  });

  const filenameBase = filenameOutput.replace(/\.[^.]+$/, "");
  const downloadFilename = `${filenameBase}.${outputExtension}`;
  const videoFilename = `${videoId}-video.${videoExtension}`;
  const primaryAudioFilename = `${videoId}-audio.${audioExtension}`;
  const outputFilename = getCompatibleFilename(`${videoId}-${downloadFilename}`);

  function handleFFmpegProgress({ progress }: { progress: number }) {
    void reportProgress({
      videoId,
      progress: 0.5 + progress * 0.5,
      progressType: ProgressType.FFmpeg,
      tabId
    });
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
    if (typeof ffmpegOutput === "string") {
      throw new Error("FFmpeg readFile returned unexpected string output");
    }

    const filesToDelete = [videoFilename, primaryAudioFilename, outputFilename, ...extraAudioFilenames];
    for (const file of filesToDelete) {
      await ffmpeg.deleteFile(file);
    }

    if (item.playlistId) {
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

    await triggerDownload(ffmpegOutput, downloadFilename);
  } finally {
    ffmpeg.off("progress", handleFFmpegProgress);
  }
}

// ─── Job processing ──────────────────────────────────────────────────────────

async function processItem(item: ProcessStreamData) {
  const job: ActiveJob = {
    ffmpeg: null,
    videoId: item.videoId,
    tabId: item.tabId
  };
  activeJobs.set(item.videoId, job);

  try {
    if (item.type === DownloadType.VideoAndAudio) {
      await enqueueMuxJob(async () => {
        const ffmpeg = await getFFmpegInstance();
        job.ffmpeg = ffmpeg;
        await processVideoAudio(item, ffmpeg);
      });
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

// ─── Public API ──────────────────────────────────────────────────────────────

export function enqueueStreamData(data: ProcessStreamData) {
  if (activeJobs.has(data.videoId)) {
    return;
  }

  // Process immediately - all downloads run in parallel
  void processItem(data);
}

export async function cancelDownloadsByIds(videoIds: string[]) {
  for (const videoId of videoIds) {
    const activeJob = activeJobs.get(videoId);
    if (!activeJob) {
      continue;
    }

    // If this job is actively using FFmpeg, terminate and recreate the shared
    // instance so the next queued mux can proceed.
    if (activeJob.ffmpeg) {
      activeJob.ffmpeg.terminate();
      sharedFFmpeg = null;
    }

    activeJobs.delete(videoId);
    await reportRemoval(videoId, activeJob.tabId);
  }
}
