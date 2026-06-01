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

type RemoveFromStorageQueueParams = {
  videoId: string;
  type: DownloadType;
};
async function removeFromStorageQueue({ videoId, type }: RemoveFromStorageQueueParams) {
  await sendMessage(MessageType.PipelineQueueRemove, {
    videoId,
    type
  });
}

async function processItem(item: ProcessStreamData) {
  const { videoId, tabId, type, filenameOutput, sourceUrl } = item;
  activeJobs.set(videoId, {
    videoId,
    tabId
  });

  await sendMessage(MessageType.PipelineStart, {
    videoId,
    type,
    filenameOutput,
    tabId,
    sourceUrl
  });

  function isCancelled() {
    return !activeJobs.has(videoId);
  }

  try {
    const isVideoAndAudio = type === DownloadType.VideoAndAudio;
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
    const isErrorInstance = error instanceof Error;
    const isMuxCancellation = isErrorInstance && error.message === MUX_JOB_CANCELLED_ERROR;
    if (isMuxCancellation) {
      return;
    }

    await reportRemoval({
      videoId,
      tabId
    });
  } finally {
    activeJobs.delete(videoId);
    await removeFromStorageQueue({
      videoId,
      type
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
      const isJobMissing = !activeJob;
      if (isJobMissing) {
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
