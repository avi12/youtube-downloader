import { removeFromPopupList } from "../queue/popup-list";
import { signalVideoComplete } from "../queue/sequential-queue";
import { MessageType, sendMessageToTab } from "@/lib/messaging/messaging";
import { mutateStorageItem, statusProgressItem } from "@/lib/storage/storage";
import { ProgressType } from "@/types";
import type { VideoTabParams } from "@/types";

export async function reportDownloadFailed({ videoId, tabId }: VideoTabParams) {
  await mutateStorageItem({
    item: statusProgressItem,
    mutator(current) {
      delete current[videoId];
    }
  });
  await sendMessageToTab(MessageType.UpdateDownloadProgress, {
    videoId,
    progress: 0,
    progressType: ProgressType.Video,
    isRemoved: true,
    isFailed: true
  }, tabId);

  await removeFromPopupList(videoId);
  signalVideoComplete(videoId);
}
