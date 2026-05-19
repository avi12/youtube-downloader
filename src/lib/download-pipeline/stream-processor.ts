import { cancelMuxJobs } from "./ffmpeg-instance";
import { MUX_JOB_CANCELLED_ERROR } from "./mux-queue";
import { processSingleMedia } from "./process-single-media";
import { processVideoAudio } from "./process-video-audio";
import { MessageType, sendMessage } from "@/lib/messaging/messaging";
import { DownloadType } from "@/types";
import type { ProcessStreamData, VideoTabParams } from "@/types";

type ActiveJob = VideoTabParams;

const activeJobs = new Map<string, ActiveJob>();

async function reportRemoval({ videoId, tabId }: VideoTabParams) {
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

  function isCancelled() {
    return !activeJobs.has(item.videoId);
  }

  try {
    const isVideoAndAudio = item.type === DownloadType.VideoAndAudio;
    if (isVideoAndAudio) {
      await processVideoAudio({
        item,
        isCancelled
      });
    } else {
      await processSingleMedia({
        item,
        isCancelled
      });
    }
  } catch (error) {
    const isMuxCancellation = (error instanceof Error) && error.message === MUX_JOB_CANCELLED_ERROR;
    if (isMuxCancellation) {
      return;
    }

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
  const isAlreadyActive = activeJobs.has(data.videoId);
  if (isAlreadyActive) {
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
