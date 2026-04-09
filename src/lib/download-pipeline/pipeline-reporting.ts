import { MessageType, sendMessage } from "../messaging";
import { ProgressType } from "@/types";
import { DownloadType } from "@/types";

export async function reportProgress({
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

export async function reportRemoval(videoId: string, tabId: number) {
  await sendMessage(MessageType.PipelineRemoval, {
    videoId,
    tabId
  });
}

export async function removeFromStorageQueue(videoId: string, type: DownloadType) {
  await sendMessage(MessageType.PipelineQueueRemove, {
    videoId,
    type
  });
}
