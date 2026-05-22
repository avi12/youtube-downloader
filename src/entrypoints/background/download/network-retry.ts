import { MessageType, sendMessageToTab } from "@/lib/messaging/messaging";
import { interruptedDownloadsItem, mutateStorageItem } from "@/lib/storage/storage";
import { ProgressType } from "@/types";
import type { DownloadRequest } from "@/types";

export const pendingNetworkRetries = new Map<string, {
  request: DownloadRequest;
  tabId: number;
}>();

async function persistInterruptedDownload(request: DownloadRequest) {
  await mutateStorageItem({
    item: interruptedDownloadsItem,
    mutator(current) {
      current[request.videoId] = {
        videoId: request.videoId,
        type: request.type,
        filenameOutput: request.filenameOutput,
        videoItag: request.videoItag,
        audioItag: request.audioItag,
        timestamp: Date.now()
      };
    }
  });
}

export async function clearInterruptedDownload(videoId: string) {
  await mutateStorageItem({
    item: interruptedDownloadsItem,
    mutator(current) {
      delete current[videoId];
    }
  });
}

export function dropPendingRetry(videoId: string) {
  pendingNetworkRetries.delete(videoId);
  void clearInterruptedDownload(videoId);
}

type QueueNetworkRetryParams = {
  request: DownloadRequest;
  tabId: number;
};
export async function queueNetworkRetry({ request, tabId }: QueueNetworkRetryParams) {
  pendingNetworkRetries.set(request.videoId, {
    request,
    tabId
  });
  await persistInterruptedDownload(request);
  void sendMessageToTab(MessageType.UpdateDownloadProgress, {
    videoId: request.videoId,
    progress: 0,
    progressType: ProgressType.Video,
    isRemoved: true,
    isInterrupted: true
  }, tabId);
}

export function registerOnlineRetryListener(
  startBackgroundDownload: (params: {
    request: DownloadRequest;
    tabId: number;
  }) => Promise<void>
) {
  addEventListener("online", () => {
    const retries = [...pendingNetworkRetries.values()];
    pendingNetworkRetries.clear();
    for (const { request, tabId } of retries) {
      void sendMessageToTab(MessageType.UpdateDownloadProgress, {
        videoId: request.videoId,
        progress: 0,
        progressType: ProgressType.Video
      }, tabId);
      void startBackgroundDownload({
        request,
        tabId
      });
    }
  });
}
