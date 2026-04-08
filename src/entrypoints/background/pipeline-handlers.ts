import { MessageType, onMessage, sendMessage } from "@/lib/messaging";
import { isFFmpegReadyItem, statusProgressItem } from "@/lib/storage";
import { ProgressType } from "@/types";
import type { ProgressUpdate } from "@/types";

type StatusProgressMap = Awaited<ReturnType<typeof statusProgressItem.getValue>>;

async function updateStatusProgress(
  mutate: (current: StatusProgressMap) => void,
  progressUpdate: ProgressUpdate,
  tabId: number
) {
  const current = await statusProgressItem.getValue();
  mutate(current);

  await Promise.allSettled([
    sendMessage(MessageType.UpdateDownloadProgress, progressUpdate, tabId),
    statusProgressItem.setValue(current)
  ]);
}

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
    await updateStatusProgress(
      current => {
        current[videoId] = { progress, progressType };
      },
      { videoId, progress, progressType },
      tabId
    );
  });

  onMessage(MessageType.PipelineRemoval, async ({ data }) => {
    const { videoId, tabId } = data;
    await updateStatusProgress(
      current => {
        delete current[videoId];
      },
      { videoId, progress: 0, progressType: ProgressType.Video, isRemoved: true },
      tabId
    );
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
