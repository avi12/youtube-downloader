import { MessageType, sendMessageToTab } from "@/lib/messaging/messaging";
import { mutateStorageItem, statusProgressItem } from "@/lib/storage/storage";
import type { Prettify, ProgressUpdate } from "@/types";

export { markVideosCancelled, isVideoCancelled, clearCancelledVideo } from "./cancelled-videos";

type StatusProgressMap = Awaited<ReturnType<typeof statusProgressItem.getValue>>;

type UpdateStatusProgressParams = Prettify<{
  mutate: (current: StatusProgressMap) => void;
  progressUpdate: ProgressUpdate;
  tabId: number;
}>;
export async function updateStatusProgress({ mutate, progressUpdate, tabId }: UpdateStatusProgressParams) {
  await Promise.allSettled([
    sendMessageToTab(MessageType.UpdateDownloadProgress, progressUpdate, tabId),
    mutateStorageItem({
      item: statusProgressItem,
      mutator: mutate
    })
  ]);
}
