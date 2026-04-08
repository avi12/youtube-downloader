import { MessageType, onMessage, sendMessage } from "@/lib/messaging";
import { isFFmpegReadyItem, statusProgressItem } from "@/lib/storage";
import { ProgressType } from "@/types";

export function registerPipelineHandlers() {
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
  });

  onMessage(MessageType.PipelineProgress, async ({ data }) => {
    const { videoId, progress, progressType, tabId } = data;
    const current = await statusProgressItem.getValue();
    current[videoId] = { progress, progressType };

    await Promise.allSettled([
      sendMessage(MessageType.UpdateDownloadProgress, {
        videoId,
        progress,
        progressType
      }, tabId),
      statusProgressItem.setValue(current)
    ]);
  });

  onMessage(MessageType.PipelineRemoval, async ({ data }) => {
    const { videoId, tabId } = data;
    const current = await statusProgressItem.getValue();
    delete current[videoId];

    await Promise.allSettled([
      sendMessage(
        MessageType.UpdateDownloadProgress,
        {
          videoId,
          progress: 0,
          progressType: ProgressType.Video,
          isRemoved: true
        },
        tabId
      ),
      statusProgressItem.setValue(current)
    ]);
  });

  onMessage(MessageType.PipelineQueueRemove, async ({ data }) => {
    const { videoId } = data;
    const current = await statusProgressItem.getValue();
    delete current[videoId];
    await statusProgressItem.setValue(current);
  });

  onMessage(MessageType.PipelineFFmpegReady, () => {
    void isFFmpegReadyItem.setValue(true);
  });

  onMessage(MessageType.PipelineDownload, ({ data }) => {
    void browser.downloads.download({
      url: data.blobUrl,
      filename: data.filename
    });
  });
}
