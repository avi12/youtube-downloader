import { getCompatibleFilename, getMimeType } from "../containers";
import { MessageType, sendMessage } from "../messaging";
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

// Keep blob references alive - without this, GC can collect the Blob before the download completes,
// causing Chrome to mark it "Deleted". Revocation is also deferred so "Show in folder" keeps working.
const activeBlobUrls = new Map<string, Blob>();

type RecentDownloadContext = {
  videoId: string;
  title: string;
  channel: string;
  thumbnailUrl?: string;
};

export async function triggerDownload(
  data: Uint8Array,
  filenameOutput: string,
  recentContext?: RecentDownloadContext
) {
  const mimeType = getMimeType(filenameOutput) || "application/octet-stream";
  const filename = getCompatibleFilename(filenameOutput);
  const blob = new Blob([new Uint8Array(data)], { type: mimeType });
  const blobUrl = URL.createObjectURL(blob);
  activeBlobUrls.set(blobUrl, blob);

  // Await so the caller reports progress=1 only after the file is written to disk,
  // not just after FFmpeg muxing.
  await sendMessage(MessageType.PipelineDownload, { blobUrl, mimeType, filename, recentContext });
}

// FFmpeg fires progress events per frame/packet including thousands of redundant progress=1 events,
// so throttle to avoid flooding Polymer button re-renders.
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
  if (progress === 0) {
    completedVideoIds.delete(videoId);
    lastProgressTimestamps.delete(videoId);
  }

  if (progress >= 1) {
    if (completedVideoIds.has(videoId)) {
      return;
    }

    completedVideoIds.add(videoId);
    lastProgressTimestamps.delete(videoId);
    await sendMessage(MessageType.PipelineProgress, { videoId, progress, progressType, tabId });
    return;
  }

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

  await sendMessage(MessageType.PipelineStart, {
    videoId: item.videoId,
    type: item.type,
    filenameOutput: item.filenameOutput,
    tabId: item.tabId
  });

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
