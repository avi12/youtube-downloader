import { enqueueMuxJob } from "./ffmpeg-instance";
import { reportRemoval, removeFromStorageQueue } from "./pipeline-reporting";
import { processSingleMedia } from "./process-single-media";
import { processVideoAudio } from "./process-video-audio";
import { DownloadType } from "@/types";
import type { ProcessStreamData } from "@/types";

export { initFFmpeg } from "./ffmpeg-instance";

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
