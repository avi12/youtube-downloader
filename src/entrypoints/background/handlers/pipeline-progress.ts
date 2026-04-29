import { removeHostedIframe } from "../iframe-host/iframe-host";
import { enqueueToPopupList, removeFromPopupList } from "../queue/popup-list";
import { signalBytesTransferred, signalVideoComplete } from "../queue/sequential-queue";
import { MessageType, onMessage, sendMessage } from "@/lib/messaging/messaging";
import { mutateStorageItem, statusProgressItem } from "@/lib/storage/storage";
import { ProgressType } from "@/types";
import type { ProgressUpdate } from "@/types";

type StatusProgressMap = Awaited<ReturnType<typeof statusProgressItem.getValue>>;

async function updateStatusProgress({ mutate, progressUpdate, tabId }: {
  mutate: (current: StatusProgressMap) => void;
  progressUpdate: ProgressUpdate;
  tabId: number;
}) {
  await Promise.allSettled([
    sendMessage(MessageType.UpdateDownloadProgress, progressUpdate, tabId),
    mutateStorageItem(statusProgressItem, mutate)
  ]);
}

export function registerPipelineProgressHandlers() {
  onMessage(MessageType.PipelineStart, async ({ data }) => {
    if (!cancelledVideoIds.has(data.videoId)) {
      await enqueueToPopupList([{
        videoId: data.videoId,
        type: data.type,
        filenameOutput: data.filenameOutput
      }]);
    }

    cancelledVideoIds.delete(data.videoId);
    signalBytesTransferred(data.videoId);
  });

  onMessage(MessageType.PipelineProgress, async ({ data }) => {
    const { videoId, progress, progressType, tabId } = data;
    await updateStatusProgress({
      mutate(current) {
        current[videoId] = {
          progress,
          progressType
        };
      },
      progressUpdate: {
        videoId,
        progress,
        progressType
      },
      tabId
    });
  });

  onMessage(MessageType.PipelineRemoval, async ({ data }) => {
    const { videoId, tabId } = data;
    await updateStatusProgress({
      mutate(current) {
        delete current[videoId];
      },
      progressUpdate: {
        videoId,
        progress: 0,
        progressType: ProgressType.Video,
        isRemoved: true,
        isFailed: true
      },
      tabId
    });
    await removeFromPopupList(videoId);
    removeHostedIframe(`dl-${videoId}`);
  });

  onMessage(MessageType.PipelineQueueRemove, async ({ data }) => {
    const { videoId } = data;
    await Promise.all([
      mutateStorageItem(statusProgressItem, current => {
        delete current[videoId];
      }),
      removeFromPopupList(videoId)
    ]);
    signalVideoComplete(videoId);
  });
}

const cancelledVideoIds = new Set<string>();

export function markVideosCancelled(videoIds: string[]) {
  for (const videoId of videoIds) {
    cancelledVideoIds.add(videoId);
  }
}
