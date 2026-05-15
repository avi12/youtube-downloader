import { MessageType, sendMessage } from "@/lib/messaging/messaging";
import { mutateStorageItem, statusProgressItem } from "@/lib/storage/storage";
import type { ProgressUpdate } from "@/types";

type StatusProgressMap = Awaited<ReturnType<typeof statusProgressItem.getValue>>;

const cancelledVideoIds = new Set<string>();

export function markVideosCancelled(videoIds: string[]) {
  for (const videoId of videoIds) {
    cancelledVideoIds.add(videoId);
  }
}

export function isVideoCancelled(videoId: string) {
  return cancelledVideoIds.has(videoId);
}

export function clearCancelledVideo(videoId: string) {
  cancelledVideoIds.delete(videoId);
}

export async function updateStatusProgress({ mutate, progressUpdate, tabId }: {
  mutate: (current: StatusProgressMap) => void;
  progressUpdate: ProgressUpdate;
  tabId: number;
}) {
  await Promise.allSettled([
    sendMessage(MessageType.UpdateDownloadProgress, progressUpdate, tabId),
    mutateStorageItem({
      item: statusProgressItem,
      mutator: mutate
    })
  ]);
}
