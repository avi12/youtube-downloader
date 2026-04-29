import { removeFromPopupList } from "../queue/popup-list";
import { signalVideoComplete } from "../queue/sequential-queue";
import { MessageType, sendMessage } from "@/lib/messaging/messaging";
import { interruptedDownloadsItem, mutateStorageItem } from "@/lib/storage/storage";
import { ProgressType } from "@/types";
import type { DownloadRequest } from "@/types";

export async function persistInterruptedDownload(request: DownloadRequest) {
  await mutateStorageItem(interruptedDownloadsItem, current => {
    current[request.videoId] = {
      videoId: request.videoId,
      type: request.type,
      filenameOutput: request.filenameOutput,
      videoItag: request.videoItag,
      audioItag: request.audioItag,
      timestamp: Date.now()
    };
  });
}

export async function clearInterruptedDownload(videoId: string) {
  await mutateStorageItem(interruptedDownloadsItem, current => {
    delete current[videoId];
  });
}

export function reportDownloadFailed({ videoId, tabId }: {
  videoId: string;
  tabId: number;
}) {
  void sendMessage(MessageType.UpdateDownloadProgress, {
    videoId,
    progress: 0,
    progressType: ProgressType.Video,
    isRemoved: true,
    isFailed: true
  }, tabId);
  void removeFromPopupList(videoId);
  signalVideoComplete(videoId);
}
