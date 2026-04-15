import { MessageType, onMessage, sendMessage } from "@/lib/messaging/messaging";
import { addRecentDownload } from "@/lib/storage/recent-downloads-db";
import type { RecentDownloadEntry } from "@/types";

// Maps videoId to the browser download ID so users can discard a completed file.
const completedDownloadIds = new Map<string, number>();

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
      state?: {
        current?: string;
      };
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
  data: Parameters<typeof persistOnDownloadComplete>[1]
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

function extractContainer(filename: string) {
  const dotIndex = filename.lastIndexOf(".");
  return dotIndex === -1 ? "" : filename.slice(dotIndex + 1).toLowerCase();
}

export function registerRecentDownloadHandlers() {
  onMessage(MessageType.PipelineDownload, async ({ data }) => {
    const targetDownloadId = await browser.downloads.download({
      url: data.blobUrl,
      filename: data.filename
    });
    if (data.recentContext?.videoId) {
      completedDownloadIds.set(data.recentContext.videoId, targetDownloadId);
    }

    if (data.recentContext) {
      void persistOnDownloadComplete(targetDownloadId, data);
    }
  });

  onMessage(MessageType.DiscardDownload, async ({ data }) => {
    const downloadId = completedDownloadIds.get(data.videoId);
    completedDownloadIds.delete(data.videoId);

    if (!downloadId) {
      return;
    }

    try {
      await browser.downloads.removeFile(downloadId);
    } catch {
      // Firefox does not support removeFile — silently ignore
    }

    await browser.downloads.erase({ id: downloadId });
  });
}
