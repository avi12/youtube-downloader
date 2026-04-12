import { MessageType, sendMessage } from "../messaging";
import { getCompatibleFilename, getMimeType } from "../utils";
import { enqueueMuxJob } from "./ffmpeg-instance";
import { processSingleMedia } from "./process-single-media";
import { processVideoAudio } from "./process-video-audio";
import { DownloadType, ProgressType } from "@/types";
import type { ProcessStreamData } from "@/types";

export { initFFmpeg } from "./ffmpeg-instance";

export function toUint8Array(data: Uint8Array | Record<string, number> | null) {
  if (!data) {
    return null;
  }

  if (!ArrayBuffer.isView(data)) {
    return new Uint8Array(Object.values(data));
  }

  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

// Keep blob references alive until Chrome's download manager finishes reading them.
// Without this, GC can collect the Blob before the download completes, causing
// Chrome to mark the download as "Deleted".
const activeBlobUrls = new Map<string, Blob>();

// Delay blob URL revocation - once revoked, chrome://downloads marks the entry
// as "Deleted" because the source URL becomes invalid. Keep URLs alive for the
// user's session so "Show in folder" works. The offscreen document's lifecycle
// cleans them up eventually.
export async function triggerDownload(data: Uint8Array, filenameOutput: string) {
  const mimeType = getMimeType(filenameOutput) || "application/octet-stream";
  const filename = getCompatibleFilename(filenameOutput);
  const blob = new Blob([new Uint8Array(data)], { type: mimeType });
  const blobUrl = URL.createObjectURL(blob);
  activeBlobUrls.set(blobUrl, blob);

  // Await the file save so the caller can report progress=1 only after
  // the file is actually written to disk (not just after FFmpeg muxing).
  await sendMessage(MessageType.PipelineDownload, { blobUrl, mimeType, filename });
}

// Throttle progress updates to avoid flooding the main thread with
// thousands of Polymer button re-renders per download (FFmpeg fires
// progress events on every frame/packet — including thousands of
// redundant progress=1 events at the end of muxing).
const progressThrottleIntervalMs = 200;
const lastProgressTimestamps = new Map<string, number>();
const completedVideoIds = new Set<string>();

export async function reportProgress({
  videoId, progress, progressType, tabId
}: {
  videoId: string;
  progress: number;
  progressType: ProgressType;
  tabId: number;
}) {
  // A new download starts with progress=0 — reset completion flag.
  if (progress === 0) {
    completedVideoIds.delete(videoId);
    lastProgressTimestamps.delete(videoId);
  }

  // Skip redundant progress=1 events after the first one.
  if (progress >= 1) {
    if (completedVideoIds.has(videoId)) {
      return;
    }

    completedVideoIds.add(videoId);
    lastProgressTimestamps.delete(videoId);
    await sendMessage(MessageType.PipelineProgress, { videoId, progress, progressType, tabId });
    return;
  }

  // Throttle intermediate progress to avoid excessive re-renders.
  const now = Date.now();
  const lastSent = lastProgressTimestamps.get(videoId) ?? 0;
  if (now - lastSent < progressThrottleIntervalMs) {
    return;
  }

  lastProgressTimestamps.set(videoId, now);
  await sendMessage(MessageType.PipelineProgress, { videoId, progress, progressType, tabId });
}

async function reportRemoval(videoId: string, tabId: number) {
  await sendMessage(MessageType.PipelineRemoval, { videoId, tabId });
}

async function removeFromStorageQueue(videoId: string, type: DownloadType) {
  await sendMessage(MessageType.PipelineQueueRemove, { videoId, type });
}

interface ActiveJob {
  videoId: string;
  tabId: number;
}

const activeJobs = new Map<string, ActiveJob>();

async function processItem(item: ProcessStreamData) {
  activeJobs.set(item.videoId, { videoId: item.videoId, tabId: item.tabId });

  try {
    if (item.type === DownloadType.VideoAndAudio) {
      await enqueueMuxJob(() => processVideoAudio(item));
    } else {
      await processSingleMedia(item);
    }
  } catch (error) {
    console.error("[ytdl:pipeline] Mux/download failed:", item.videoId, error);
    await reportRemoval(item.videoId, item.tabId);
  } finally {
    activeJobs.delete(item.videoId);
    await removeFromStorageQueue(item.videoId, item.type);
  }
}

export function enqueueStreamData(data: ProcessStreamData) {
  if (activeJobs.has(data.videoId)) {
    return;
  }

  void processItem(data);
}

export async function cancelDownloadsByIds(videoIds: string[]) {
  await Promise.all(
    videoIds.map(async videoId => {
      const activeJob = activeJobs.get(videoId);
      if (!activeJob) {
        return;
      }

      activeJobs.delete(videoId);
      await reportRemoval(videoId, activeJob.tabId);
    })
  );
}
