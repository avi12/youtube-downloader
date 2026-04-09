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
import type { FFmpegCoreModule, Progress } from "@ffmpeg/types";
import { zipSync } from "fflate";

// ─── FFmpeg configuration ────────────────────────────────────────────────────
// A single FFmpeg instance is reused across all mux jobs. WASM can only run one
// exec() at a time, so mux operations are serialized via a queue while downloads
// still run in parallel.

let sharedFFmpeg: FFmpegCoreModule | null = null;
const progressHandlers = new Set<(progress: Progress) => void>();

export function initFFmpeg(core: FFmpegCoreModule) {
  sharedFFmpeg = core;
  core.setProgress(progress => {
    for (const handler of progressHandlers) {
      handler(progress);
    }
  });
  void sendMessage(MessageType.PipelineFFmpegReady, {});
}

function getFFmpeg() {
  if (!sharedFFmpeg) {
    throw new Error("initFFmpeg() must be called before processing video+audio downloads");
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

async function enqueueMuxJob(job: () => Promise<void>) {
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

function matchesMagicBytes(data: Uint8Array, bytes: number[], offset = 0) {
  return bytes.every((byte, i) => data[offset + i] === byte);
}

const jpegMagicBytes = [0xFF, 0xD8, 0xFF];
const pngMagicBytes = [0x89, 0x50, 0x4E, 0x47];
const riffMagicBytes = [0x52, 0x49, 0x46, 0x46];
const webpMagicBytes = [0x57, 0x45, 0x42, 0x50];
const webpMagicOffset = 8;

function detectImageExtension(data: Uint8Array) {
  if (matchesMagicBytes(data, jpegMagicBytes)) {
    return "jpg";
  }

  if (matchesMagicBytes(data, pngMagicBytes)) {
    return "png";
  }

  if (matchesMagicBytes(data, riffMagicBytes) && matchesMagicBytes(data, webpMagicBytes, webpMagicOffset)) {
    return "webp";
  }

  return "jpg";
}

const thumbnailFetchTimeoutMs = 10_000;

async function fetchThumbnail(url: string) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(thumbnailFetchTimeoutMs) });
    if (!response.ok) {
      return null;
    }

    const data = new Uint8Array(await response.arrayBuffer());
    return { data, extension: detectImageExtension(data) };
  } catch {
    return null;
  }
}

async function embedMusicMetadata(
  audioData: Uint8Array,
  filenameOutput: string,
  metadata: VideoMetadata,
  ffmpeg: FFmpegCoreModule
) {
  const audioExtension = getFileExtension(filenameOutput) || "m4a";
  const inputFilename = `input.${audioExtension}`;
  const outputFilename = getCompatibleFilename(filenameOutput);

  ffmpeg.FS.writeFile(inputFilename, audioData);

  const ffmpegArgs = ["-i", inputFilename];

  // Download and attach thumbnail as cover art.
  // WebM containers don't support MJPEG cover art — skip for weba/webm.
  const isWebmAudio = audioExtension === "weba" || audioExtension === "webm";
  let isCoverArtPresent = false;
  let coverFilename = "";
  if (metadata.thumbnailUrl && !isWebmAudio) {
    const thumbnail = await fetchThumbnail(metadata.thumbnailUrl);
    if (thumbnail) {
      coverFilename = `cover.${thumbnail.extension}`;
      ffmpeg.FS.writeFile(coverFilename, thumbnail.data);
      ffmpegArgs.push("-i", coverFilename);
      isCoverArtPresent = true;
    }
  }

  ffmpegArgs.push("-map", "0:a");

  if (isCoverArtPresent) {
    ffmpegArgs.push("-map", "1");
    // JPEG is already MJPEG — copy as-is. Other formats (WebP, PNG) must be
    // transcoded to MJPEG since that is what MP4/M4A cover art expects.
    const isJpeg = coverFilename.endsWith(".jpg");
    ffmpegArgs.push("-c:v", isJpeg ? "copy" : "mjpeg");
    ffmpegArgs.push("-disposition:v", "attached_pic");
  }

  ffmpegArgs.push("-c:a", "copy");
  ffmpegArgs.push("-metadata", `title=${metadata.title}`);
  ffmpegArgs.push("-metadata", `artist=${metadata.artist}`);

  if (metadata.date) {
    ffmpegArgs.push("-metadata", `date=${metadata.date}`);
  }

  ffmpegArgs.push(outputFilename);

  const exitCode = ffmpeg.exec(...ffmpegArgs);
  if (exitCode !== 0) {
    // Fallback: return original data without tags
    ffmpeg.FS.unlink(inputFilename);
    return audioData;
  }

  const taggedOutput = ffmpeg.FS.readFile(outputFilename, { encoding: "binary" });
  ffmpeg.FS.unlink(inputFilename);
  ffmpeg.FS.unlink(outputFilename);

  if (isCoverArtPresent) {
    ffmpeg.FS.unlink(coverFilename);
  }

  // Guard against empty output — can happen if FFmpeg silently fails
  // (e.g. MJPEG cover art rejected for WebM container)
  if (typeof taggedOutput === "string" || taggedOutput.byteLength === 0) {
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
      progress: 0,
      progressType: ProgressType.FFmpeg,
      tabId
    });

    await enqueueMuxJob(async () => {
      const ffmpeg = getFFmpeg();
      data = await embedMusicMetadata(data!, filenameOutput, item.metadata!, ffmpeg);
    });

    await reportProgress({
      videoId,
      progress: 1,
      progressType: ProgressType.FFmpeg,
      tabId
    });
  }

  await reportProgress({
    videoId,
    progress: 1,
    progressType: ProgressType.FFmpeg,
    tabId
  });

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

async function processVideoAudio(item: ProcessStreamData, ffmpeg: FFmpegCoreModule) {
  const {
    videoId, filenameOutput,
    videoMimeType, audioMimeType, tabId,
    additionalAudioStreams
  } = item;
  const videoData = toUint8Array(item.videoData);
  const audioData = toUint8Array(item.audioData);
  if (!videoData || !audioData) {
    await reportProgress({
      videoId,
      progress: 1,
      progressType: ProgressType.FFmpeg,
      tabId
    });

    if (videoData) {
      await triggerDownload(videoData, filenameOutput);
    } else if (audioData) {
      await triggerDownload(audioData, filenameOutput);
    }

    return;
  }

  await reportProgress({
    videoId,
    progress: 0,
    progressType: ProgressType.FFmpeg,
    tabId
  });

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

  function handleFFmpegProgress({ progress }: Progress) {
    void reportProgress({
      videoId,
      progress,
      progressType: ProgressType.FFmpeg,
      tabId
    });
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

    await reportProgress({
      videoId,
      progress: 1,
      progressType: ProgressType.FFmpeg,
      tabId
    });

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
    progressHandlers.delete(handleFFmpegProgress);
  }
}

// ─── Job processing ──────────────────────────────────────────────────────────

async function processItem(item: ProcessStreamData) {
  const job: ActiveJob = {
    videoId: item.videoId,
    tabId: item.tabId
  };
  activeJobs.set(item.videoId, job);

  try {
    if (item.type === DownloadType.VideoAndAudio) {
      await enqueueMuxJob(async () => {
        await processVideoAudio(item, getFFmpeg());
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
  await Promise.all(videoIds.map(async videoId => {
    const activeJob = activeJobs.get(videoId);
    if (!activeJob) {
      return;
    }

    activeJobs.delete(videoId);
    await reportRemoval(videoId, activeJob.tabId);
  }));
}
