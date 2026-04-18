import { enqueueToPopupList, removeFromPopupList } from "../queue/popup-list";
import { signalBytesTransferred, signalVideoComplete } from "../queue/sequential-queue";
import { registerRecentDownloadHandlers } from "../recent/recent-download-handler";
import { signalFFmpegReady } from "./processor";
import { MessageType, onMessage, sendMessage } from "@/lib/messaging/messaging";
import { isFFmpegReadyItem, mutateStorageItem, statusProgressItem } from "@/lib/storage/storage";
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

export function registerPipelineHandlers() {
  registerRecentDownloadHandlers();

  onMessage(MessageType.ProcessStreamError, ({ data, sender }) => {
    const tabId = sender.tab?.id;
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
        isRemoved: true
      },
      tabId
    );
    void sendMessage(MessageType.RemoveDownloadIframe, { videoId: data.videoId }, tabId);
  });

  onMessage(MessageType.PipelineStart, async ({ data }) => {
    await enqueueToPopupList({
      videoId: data.videoId,
      type: data.type,
      filenameOutput: data.filenameOutput
    });
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
    void sendMessage(MessageType.RemoveDownloadIframe, { videoId }, tabId);
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

  onMessage(MessageType.PipelineFFmpegReady, () => {
    void isFFmpegReadyItem.setValue(true);
    signalFFmpegReady();
  });

  onMessage(MessageType.PipelineZipProgress, ({ data }) => {
    const { playlistId, isDone, tabId } = data;
    void sendMessage(
      MessageType.UpdateDownloadProgress,
      {
        videoId: `zip:${playlistId}`,
        progress: isDone ? 1 : 0,
        progressType: ProgressType.Zip
      },
      tabId
    );
  });
}
