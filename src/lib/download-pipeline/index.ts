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

export async function triggerDownload(data: Uint8Array, filenameOutput: string) {
  const mimeType = getMimeType(filenameOutput) || "application/octet-stream";
  const filename = getCompatibleFilename(filenameOutput);
  const blob = new Blob([new Uint8Array(data)], { type: mimeType });
  const blobUrl = URL.createObjectURL(blob);

  // Blob URLs are scoped to the document that created them (offscreen doc).
  // browser.downloads.download() in the background SW can't access them.
  // Trigger the download directly from this document via an anchor element.
  const elAnchor = document.createElement("a");
  elAnchor.href = blobUrl;
  elAnchor.download = filename;
  elAnchor.click();

  URL.revokeObjectURL(blobUrl);
}

export async function reportProgress({
  videoId, progress, progressType, tabId
}: {
  videoId: string;
  progress: number;
  progressType: ProgressType;
  tabId: number;
}) {
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
