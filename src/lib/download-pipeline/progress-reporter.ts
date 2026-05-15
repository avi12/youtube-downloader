import { MessageType, sendMessage } from "@/lib/messaging/messaging";
import { ProgressType } from "@/types";

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
  const isNotComplete = progress < 1;
  if (isNotComplete) {
    completedVideoIds.delete(videoId);
  }

  const isReset = progress === 0;
  if (isReset) {
    lastProgressTimestamps.delete(videoId);
  }

  const isComplete = progress >= 1;
  if (isComplete) {
    const isAlreadyCompleted = completedVideoIds.has(videoId);
    if (isAlreadyCompleted) {
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
  const isThrottled = now - lastSent < PROGRESS_THROTTLE_INTERVAL_MS;
  if (isThrottled) {
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
