import { cancelMuxJobs } from "./ffmpeg-instance";
import { processSingleMedia } from "./process-single-media";
import { processVideoAudio } from "./process-video-audio";
import { MessageType, sendMessage } from "@/lib/messaging/messaging";
import type { RecentDownloadContext } from "@/lib/messaging/messaging";
import { getCompatibleFilename, getMimeType } from "@/lib/utils/containers";
import { DownloadType, ProgressType } from "@/types";
import type { ProcessStreamData } from "@/types";

export { initMuxWorker } from "./ffmpeg-instance";

export const FFMPEG_PROGRESS_CAP = 0.99;

export function buildRecentContext(
  item: Pick<ProcessStreamData, "videoId" | "filenameOutput" | "metadata">,
  extras?: Partial<RecentDownloadContext>
): RecentDownloadContext {
  return {
    videoId: item.videoId,
    title: item.metadata?.title ?? item.filenameOutput,
    channel: item.metadata?.artist ?? "",
    thumbnailUrl: item.metadata?.thumbnailUrl,
    ...extras
  };
}

export function toOwnedArrayBuffer(view: ArrayBufferView) {
  if (!(view.buffer instanceof ArrayBuffer)) {
    throw new Error("SharedArrayBuffer is not supported");
  }

  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
}

export function toUint8Array(data: Uint8Array | Record<string, number> | null) {
  if (!data) {
    return null;
  }

  if (!ArrayBuffer.isView(data)) {
    return new Uint8Array(Object.values(data));
  }

  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

const blobUrlsPendingRevocation = new Map<string, Blob>();
const BLOB_REVOCATION_DELAY_MS = 60_000;

export async function triggerDownload({ data, filenameOutput, recentContext }: {
  data: Uint8Array;
  filenameOutput: string;
  recentContext?: RecentDownloadContext;
}) {
  const mimeType = getMimeType(filenameOutput) || "application/octet-stream";
  const filename = getCompatibleFilename(filenameOutput);
  const blob = new Blob([new Uint8Array(data)], { type: mimeType });
  const blobUrl = URL.createObjectURL(blob);
  blobUrlsPendingRevocation.set(blobUrl, blob);

  await sendMessage(MessageType.PipelineDownload, {
    blobUrl,
    mimeType,
    filename,
    recentContext
  });

  setTimeout(() => {
    URL.revokeObjectURL(blobUrl);
    blobUrlsPendingRevocation.delete(blobUrl);
  }, BLOB_REVOCATION_DELAY_MS);
}

// FFmpeg fires progress events per frame/packet including thousands of redundant progress=1 events,
// so throttle to avoid flooding Polymer button re-renders.
const PROGRESS_THROTTLE_INTERVAL_MS = 200;
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
  if (progress < 1) {
    completedVideoIds.delete(videoId);
  }

  if (progress === 0) {
    lastProgressTimestamps.delete(videoId);
  }

  if (progress >= 1) {
    if (completedVideoIds.has(videoId)) {
      return;
    }

    completedVideoIds.add(videoId);
    lastProgressTimestamps.delete(videoId);
    await sendMessage(MessageType.PipelineProgress, {
      videoId,
      progress,
      progressType,
      tabId
    });
    return;
  }

  const now = Date.now();
  const lastSent = lastProgressTimestamps.get(videoId) ?? 0;
  if (now - lastSent < PROGRESS_THROTTLE_INTERVAL_MS) {
    return;
  }

  lastProgressTimestamps.set(videoId, now);
  await sendMessage(MessageType.PipelineProgress, {
    videoId,
    progress,
    progressType,
    tabId
  });
}

async function reportRemoval({ videoId, tabId }: {
  videoId: string;
  tabId: number;
}) {
  await sendMessage(MessageType.PipelineRemoval, {
    videoId,
    tabId
  });
}

async function removeFromStorageQueue({ videoId, type }: {
  videoId: string;
  type: DownloadType;
}) {
  await sendMessage(MessageType.PipelineQueueRemove, {
    videoId,
    type
  });
}

interface ActiveJob {
  videoId: string;
  tabId: number;
}

const activeJobs = new Map<string, ActiveJob>();

async function processItem(item: ProcessStreamData) {
  activeJobs.set(item.videoId, {
    videoId: item.videoId,
    tabId: item.tabId
  });

  await sendMessage(MessageType.PipelineStart, {
    videoId: item.videoId,
    type: item.type,
    filenameOutput: item.filenameOutput,
    tabId: item.tabId
  });

  function isCancelled() {
    return !activeJobs.has(item.videoId);
  }

  try {
    if (item.type === DownloadType.VideoAndAudio) {
      await processVideoAudio(item, isCancelled);
    } else {
      await processSingleMedia(item, isCancelled);
    }
  } catch (error) {
    if ((error instanceof Error) && error.message === "muxJobCancelled") {
      return;
    }

    console.error("[ytdl:pipeline] Mux/download failed:", item.videoId, error);
    await reportRemoval({
      videoId: item.videoId,
      tabId: item.tabId
    });
  } finally {
    activeJobs.delete(item.videoId);
    await removeFromStorageQueue({
      videoId: item.videoId,
      type: item.type
    });
  }
}

export function enqueueStreamData(data: ProcessStreamData) {
  if (activeJobs.has(data.videoId)) {
    return;
  }

  void processItem(data);
}

export async function cancelDownloadsByIds(videoIds: string[]) {
  cancelMuxJobs(videoIds);
  await Promise.all(
    videoIds.map(async videoId => {
      const activeJob = activeJobs.get(videoId);
      if (!activeJob) {
        return;
      }

      activeJobs.delete(videoId);
      await reportRemoval({
        videoId,
        tabId: activeJob.tabId
      });
    })
  );
}
