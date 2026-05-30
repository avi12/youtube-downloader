import { removeFromPopupList } from "../queue/popup-list";
import { signalVideoComplete } from "../queue/sequential-queue";
import { MessageType, sendMessageToTab } from "@/lib/messaging/messaging";
import { ProgressType } from "@/types";
import type { VideoTabParams } from "@/types";

export function reportDownloadFailed({ videoId, tabId }: VideoTabParams) {
  void sendMessageToTab(MessageType.UpdateDownloadProgress, {
    videoId,
    progress: 0,
    progressType: ProgressType.Video,
    isRemoved: true,
    isFailed: true
  }, tabId);

  void removeFromPopupList(videoId);
  signalVideoComplete(videoId);
}
