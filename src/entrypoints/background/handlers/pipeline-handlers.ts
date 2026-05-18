import { enqueueToPopupList, removeFromPopupList } from "../queue/popup-list";
import { signalBytesTransferred } from "../queue/sequential-queue";
import { resolveTabId } from "../queue/tab-tracker";
import { registerRecentDownloadHandlers } from "../recent/recent-download-handler";
import { registerPipelineQueueHandlers } from "./pipeline-queue-handlers";
import { clearCancelledVideo, isVideoCancelled, updateStatusProgress } from "./pipeline-state";
import { MessageType, onMessage, sendMessage } from "@/lib/messaging/messaging";
import { OffscreenMessageType, sendToOffscreen } from "@/lib/messaging/offscreen-messaging";
import { ProgressType } from "@/types";

export { markVideosCancelled } from "./pipeline-state";

export function registerPipelineHandlers() {
  registerRecentDownloadHandlers();
  registerPipelineQueueHandlers();

  onMessage(MessageType.ProcessStreamError, ({ data, sender }) => {
    const tabId = resolveTabId({
      sender,
      videoId: data.videoId
    });
    if (!tabId) {
      return;
    }

    console.error("[ytdl] Stream error for", data.videoId, data.error);
    void sendMessage(
      MessageType.UpdateDownloadProgress,
      {
        videoId: data.videoId,
        progress: 0,
        progressType: ProgressType.Video,
        isRemoved: true,
        isFailed: true
      },
      tabId
    );
    sendToOffscreen({
      type: OffscreenMessageType.RemoveDownloadIframe,
      data: {
        videoId: data.videoId
      }
    });
  });

  onMessage(MessageType.PipelineStart, async ({ data }) => {
    const isNotCancelled = !isVideoCancelled(data.videoId);
    if (isNotCancelled) {
      await enqueueToPopupList({
        videoId: data.videoId,
        type: data.type,
        filenameOutput: data.filenameOutput,
        tabId: data.tabId
      });
    }

    clearCancelledVideo(data.videoId);
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
    sendToOffscreen({
      type: OffscreenMessageType.RemoveDownloadIframe,
      data: {
        videoId
      }
    });
  });
}
