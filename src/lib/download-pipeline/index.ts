import { enqueueMuxJob } from "./ffmpeg-instance";
import { processMultipartSegments } from "./process-multipart-segments";
import { processSingleMedia } from "./process-single-media";
import { processVideoAudio } from "./process-video-audio";
import { MessageType, sendMessage } from "@/lib/messaging/messaging";
import { DownloadType } from "@/types";
import type { ProcessStreamData } from "@/types";

export { initFFmpeg } from "./ffmpeg-instance";
export { triggerDownload } from "./trigger-download";
export { reportProgress } from "./report-progress";

export function toUint8Array(data: Uint8Array | Record<string, number> | null) {
  if (!data) {
    return null;
  }

  if (!ArrayBuffer.isView(data)) {
    return new Uint8Array(Object.values(data));
  }

  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

interface ActiveJob {
  videoId: string;
  tabId: number;
}

const activeJobs = new Map<string, ActiveJob>();

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

  try {
    if (item.segments && item.segments.length > 0) {
      await enqueueMuxJob(() => processMultipartSegments({
        ...item,
        segments: item.segments!
      }));
    } else if (item.type === DownloadType.VideoAndAudio) {
      await enqueueMuxJob(() => processVideoAudio(item));
    } else {
      await processSingleMedia(item);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[ytdl:pipeline] Mux/download failed:", item.videoId, error);
    await sendMessage(MessageType.ProcessStreamError, {
      videoId: item.videoId,
      error: `[mux] ${message}`
    });
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
