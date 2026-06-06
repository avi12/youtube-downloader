import { removeFromPopupList } from "../queue/popup-list";
import { signalVideoComplete } from "../queue/sequential-queue";
import { signalFFmpegReady } from "./processor";
import { MessageType, onMessage, sendMessage } from "@/lib/messaging/messaging";
import { isFFmpegReadyItem, mutateStorageItem, statusProgressItem } from "@/lib/storage/storage";
import { ProgressType } from "@/types";

const ZIP_VIDEO_ID_PREFIX = "zip:";

export function registerPipelineQueueHandlers() {
  onMessage(MessageType.PipelineQueueRemove, async ({ data }) => {
    const { videoId } = data;
    await Promise.all([
      mutateStorageItem({
        item: statusProgressItem,
        mutator(current) {
          const isCompletedEntry = current[videoId]?.isDone;
          if (isCompletedEntry) {
            return;
          }

          delete current[videoId];
        }
      }),
      removeFromPopupList(videoId)
    ]);
    signalVideoComplete(videoId);
  });

  onMessage(MessageType.PipelineFFmpegReady, () => {
    isFFmpegReadyItem.setValue(true).catch(() => {});
    signalFFmpegReady();
  });

  onMessage(MessageType.PipelineZipProgress, ({ data }) => {
    const { playlistId, isDone, tabId } = data;
    sendMessage(
      MessageType.UpdateDownloadProgress,
      {
        videoId: `${ZIP_VIDEO_ID_PREFIX}${playlistId}`,
        progress: isDone ? 1 : 0,
        progressType: ProgressType.Zip
      },
      tabId
    ).catch(() => {});
  });
}
