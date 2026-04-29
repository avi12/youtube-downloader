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
