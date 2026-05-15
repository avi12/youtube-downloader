import { removeFromPopupList } from "../queue/popup-list";
import { signalVideoComplete } from "../queue/sequential-queue";
import { signalFFmpegReady } from "./processor";
import { MessageType, onMessage, sendMessage } from "@/lib/messaging/messaging";
import { isFFmpegReadyItem, mutateStorageItem, statusProgressItem } from "@/lib/storage/storage";
import { ProgressType } from "@/types";

export function registerPipelineQueueHandlers() {
  onMessage(MessageType.PipelineQueueRemove, async ({ data }) => {
    const { videoId } = data;
    await Promise.all([
      mutateStorageItem({
        item: statusProgressItem,
        mutator(current) {
          delete current[videoId];
        }
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
