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
      current[videoId] = {
        isDownloading: false,
        isDone: false,
        isFailed: true,
        progress: 0,
        progressType: ""
      };
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

// Terminal state for videos YouTube reports as unplayable (removed, private, or
// region-blocked). Unlike a generic failure this is never auto-retried, since a
// fresh attempt can't bring back a video the channel owner took down.
export async function reportVideoUnavailable({ videoId, tabId }: VideoTabParams) {
  await mutateStorageItem({
    item: statusProgressItem,
    mutator(current) {
      current[videoId] = {
        isDownloading: false,
        isDone: false,
        isFailed: true,
        isUnavailable: true,
        progress: 0,
        progressType: ""
      };
    }
  });
  await sendMessageToTab(MessageType.UpdateDownloadProgress, {
    videoId,
    progress: 0,
    progressType: ProgressType.Video,
    isRemoved: true,
    isFailed: true,
    isUnavailable: true
  }, tabId);

  await removeFromPopupList(videoId);
  signalVideoComplete(videoId);
}
