import { enqueueToPopupList, removeFromPopupList } from "../queue/popup-list";
import { signalBytesTransferred } from "../queue/sequential-queue";
import { resolveTabId } from "../queue/tab-tracker";
import { registerRecentDownloadHandlers } from "../recent/recent-downloads";
import { registerPipelineQueueHandlers } from "./pipeline-queue-handlers";
import { clearCancelledVideo, isVideoCancelled, updateStatusProgress } from "./pipeline-state";
import { MessageType, onMessage, sendMessageToTab } from "@/lib/messaging/messaging";
import { OffscreenMessageType, sendToOffscreen } from "@/lib/messaging/offscreen-messaging";
import { ProgressType } from "@/types";

export { markVideosCancelled } from "./pipeline-state";

export function registerPipelineHandlers() {
  registerRecentDownloadHandlers();
  registerPipelineQueueHandlers();

  onMessage(MessageType.ProcessStreamError, async ({ data, sender }) => {
    const tabId = resolveTabId({
      sender,
      videoId: data.videoId
    });
    if (!tabId) {
      return;
    }

    const isCancelStreamAbort = isVideoCancelled(data.videoId);
    if (isCancelStreamAbort) {
      sendToOffscreen({
        type: OffscreenMessageType.RemoveDownloadIframe,
        data: {
          videoId: data.videoId
        }
      });
      return;
    }

    console.error("[ytdl] Stream error for", data.videoId, data.error);
    await sendMessageToTab(
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
    const isCancelled = isVideoCancelled(data.videoId);
    if (!isCancelled) {
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
    const isComplete = progress >= 1 && progressType === ProgressType.FFmpeg;
    await updateStatusProgress({
      mutate(current) {
        current[videoId] = {
          isDownloading: !isComplete,
          isDone: isComplete,
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
    const isCancelRemoval = isVideoCancelled(videoId);
    await updateStatusProgress({
      mutate(current) {
        delete current[videoId];
      },
      progressUpdate: {
        videoId,
        progress: 0,
        progressType: ProgressType.Video,
        isRemoved: true,
        isFailed: !isCancelRemoval
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
