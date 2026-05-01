import { MessageType, onMessage, sendMessage } from "@/lib/messaging/messaging";
import { addRecentDownload } from "@/lib/storage/recent-downloads-db";
import type { RecentDownloadEntry } from "@/types";

async function persistOnDownloadComplete({ targetDownloadId, data }: {
  targetDownloadId: number;
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
  };
}) {
  return new Promise<void>(resolve => {
    function handleChanged(delta: Browser.downloads.DownloadDelta) {
      if (delta.id !== targetDownloadId || !delta.state?.current) {
        return;
      }

      if (delta.state.current === browser.downloads.State.COMPLETE) {
        browser.downloads.onChanged.removeListener(handleChanged);
        void persistRecentDownload({
          downloadId: targetDownloadId,
          data
        }).finally(resolve);
        return;
      }

      if (delta.state.current === browser.downloads.State.INTERRUPTED) {
        browser.downloads.onChanged.removeListener(handleChanged);
        resolve();
      }
    }

    browser.downloads.onChanged.addListener(handleChanged);
  });
}

async function persistRecentDownload({ downloadId, data }: {
  downloadId: number;
  data: Parameters<typeof persistOnDownloadComplete>[0]["data"];
}) {
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
    await addRecentDownload({
      entry,
      blob
    });
    try {
      await sendMessage(MessageType.RecentDownloadsChanged, {});
    } catch {
      // popup not open
    }
  } catch (error) {
    console.warn("[ytdl:bg] Persist recent download failed:", error);
  }
}

function extractContainer(filename: string) {
  const iDot = filename.lastIndexOf(".");
  return iDot === -1 ? "" : filename.slice(iDot + 1).toLowerCase();
}

export function registerRecentDownloadHandlers() {
  onMessage(MessageType.PipelineDownload, async ({ data }) => {
    const targetDownloadId = await browser.downloads.download({
      url: data.blobUrl,
      filename: data.filename
    });
    if (data.recentContext) {
      void persistOnDownloadComplete({
        targetDownloadId,
        data
      });
    }
  });
}
