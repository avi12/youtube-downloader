import { signalFFmpegReady } from "./processor";
import { signalVideoComplete } from "./sequential-queue";
import { MessageType, onMessage, sendMessage } from "@/lib/messaging";
import { addRecentDownload } from "@/lib/recent-downloads-db";
import {
  isFFmpegReadyItem,
  musicListItem,
  statusProgressItem,
  videoDetailsItem,
  videoOnlyListItem,
  videoQueueItem
} from "@/lib/storage";
import { DownloadType, ProgressType } from "@/types";
import type { ProgressUpdate, RecentDownloadEntry } from "@/types";

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
    void sendMessage(MessageType.RemoveDownloadIframe, { videoId: data.videoId }, tabId);
  });

  onMessage(MessageType.PipelineStart, async ({ data }) => {
    await enqueueToPopupList(data.videoId, data.type, data.filenameOutput);
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
    await removeFromPopupList(videoId);
    void sendMessage(MessageType.RemoveDownloadIframe, { videoId }, tabId);
  });

  onMessage(MessageType.PipelineQueueRemove, async ({ data }) => {
    const { videoId } = data;
    const current = await statusProgressItem.getValue();
    delete current[videoId];
    await statusProgressItem.setValue(current);
    await removeFromPopupList(videoId);
    signalVideoComplete(videoId);
  });

  onMessage(MessageType.PipelineFFmpegReady, () => {
    void isFFmpegReadyItem.setValue(true);
    signalFFmpegReady();
  });

  onMessage(MessageType.PipelineDownload, async ({ data }) => {
    const targetDownloadId = await browser.downloads.download({
      url: data.blobUrl,
      filename: data.filename
    });
    if (data.recentContext) {
      void persistOnDownloadComplete(targetDownloadId, data);
    }
  });
}

function persistOnDownloadComplete(
  targetDownloadId: number,
  data: {
    blobUrl: string;
    mimeType: string;
    filename: string;
    recentContext?: {
      videoId: string;
      title: string;
      channel: string;
      thumbnailUrl?: string;
    };
  }
) {
  return new Promise<void>(resolve => {
    function handleChanged(delta: {
      id: number;
      state?: { current?: string };
    }) {
      if (delta.id !== targetDownloadId || !delta.state?.current) {
        return;
      }

      if (delta.state.current === "complete") {
        browser.downloads.onChanged.removeListener(handleChanged);
        void persistRecentDownload(targetDownloadId, data).finally(resolve);
        return;
      }

      if (delta.state.current === "interrupted") {
        browser.downloads.onChanged.removeListener(handleChanged);
        resolve();
      }
    }

    browser.downloads.onChanged.addListener(handleChanged);
  });
}

async function persistRecentDownload(
  downloadId: number,
  data: {
    blobUrl: string;
    mimeType: string;
    filename: string;
    recentContext?: {
      videoId: string;
      title: string;
      channel: string;
      thumbnailUrl?: string;
    };
  }
) {
  const context = data.recentContext;
  if (!context) {
    return;
  }

  try {
    const response = await fetch(data.blobUrl);
    const blob = await response.blob();
    const entry: RecentDownloadEntry = {
      id: crypto.randomUUID(),
      downloadId,
      videoId: context.videoId,
      title: context.title,
      channel: context.channel,
      filename: data.filename,
      container: extractContainer(data.filename),
      mimeType: data.mimeType,
      size: blob.size,
      thumbnailUrl: context.thumbnailUrl,
      completedAt: Date.now()
    };
    await addRecentDownload(entry, blob);
    try {
      await sendMessage(MessageType.RecentDownloadsChanged, {});
    } catch {
      // Popup not open — ignore.
    }
  } catch (error) {
    console.warn("[ytdl:bg] Persist recent download failed:", error);
  }
}

async function enqueueToPopupList(videoId: string, type: DownloadType, filenameOutput: string) {
  const details = await videoDetailsItem.getValue();
  details[videoId] = { filenameOutput };
  await videoDetailsItem.setValue(details);

  if (type === DownloadType.VideoAndAudio) {
    const queue = await videoQueueItem.getValue();
    if (!queue.some(item => item.videoId === videoId)) {
      queue.push({ videoId, filenameOutput });
      await videoQueueItem.setValue(queue);
    }

    return;
  }

  const listItem = type === DownloadType.Audio ? musicListItem : videoOnlyListItem;
  const list = await listItem.getValue();
  if (!list.includes(videoId)) {
    list.push(videoId);
    await listItem.setValue(list);
  }
}

async function removeFromPopupList(videoId: string) {
  const [queue, musicList, videoOnlyList, details] = await Promise.all([
    videoQueueItem.getValue(),
    musicListItem.getValue(),
    videoOnlyListItem.getValue(),
    videoDetailsItem.getValue()
  ]);

  const queueIndex = queue.findIndex(item => item.videoId === videoId);
  const musicIndex = musicList.indexOf(videoId);
  const videoOnlyIndex = videoOnlyList.indexOf(videoId);
  const hadDetails = videoId in details;

  const writes: Promise<void>[] = [];
  if (queueIndex !== -1) {
    queue.splice(queueIndex, 1);
    writes.push(videoQueueItem.setValue(queue));
  }

  if (musicIndex !== -1) {
    musicList.splice(musicIndex, 1);
    writes.push(musicListItem.setValue(musicList));
  }

  if (videoOnlyIndex !== -1) {
    videoOnlyList.splice(videoOnlyIndex, 1);
    writes.push(videoOnlyListItem.setValue(videoOnlyList));
  }

  if (hadDetails) {
    delete details[videoId];
    writes.push(videoDetailsItem.setValue(details));
  }

  await Promise.all(writes);
}

function extractContainer(filename: string) {
  const dotIndex = filename.lastIndexOf(".");
  return dotIndex === -1 ? "" : filename.slice(dotIndex + 1).toLowerCase();
}
