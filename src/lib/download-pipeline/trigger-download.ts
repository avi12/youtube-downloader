import { MessageType, sendMessage } from "@/lib/messaging/messaging";
import { addRecentDownload } from "@/lib/storage/recent-downloads-db";
import type { RecentDownloadEntry } from "@/lib/storage/recent-downloads-db";
import { getCompatibleFilename, getMimeType } from "@/lib/utils/containers";

const blobUrlsPendingRevocation = new Map<string, Blob>();
const BLOB_REVOCATION_DELAY_MS = 60_000;
const DOWNLOAD_RETRY_INTERVAL_MS = 3_000;
const DOWNLOAD_MAX_RETRIES = 20;

type RecentContext = {
  videoId: string;
  title: string;
  channel: string;
  thumbnailUrl?: string;
};

async function persistFirefoxRecentDownload({ downloadId, blobUrl, mimeType, filename, recentContext }: {
  downloadId: number;
  blobUrl: string;
  mimeType: string;
  filename: string;
  recentContext: RecentContext;
}) {
  const isComplete = await new Promise<boolean>(resolve => {
    function onChanged(delta: Browser.downloads.DownloadDelta) {
      if (delta.id !== downloadId || !delta.state?.current) {
        return;
      }

      browser.downloads.onChanged.removeListener(onChanged);
      resolve(delta.state.current === browser.downloads.State.COMPLETE);
    }

    browser.downloads.onChanged.addListener(onChanged);
  });
  if (!isComplete) {
    return;
  }

  try {
    const response = await fetch(blobUrl);
    const fileBlob = await response.blob();
    const iDot = filename.lastIndexOf(".");
    const entry: RecentDownloadEntry = {
      id: crypto.randomUUID(),
      downloadId,
      videoId: recentContext.videoId,
      title: recentContext.title,
      channel: recentContext.channel,
      filename,
      container: iDot === -1 ? "" : filename.slice(iDot + 1).toLowerCase(),
      mimeType,
      size: fileBlob.size,
      thumbnailUrl: recentContext.thumbnailUrl,
      completedAt: Date.now()
    };
    await addRecentDownload({
      entry,
      blob: fileBlob
    });
    sendMessage(MessageType.RecentDownloadsChanged, {}).catch(() => {});
  } catch (error) {
    console.warn("[ytdl:pipeline] Firefox recent download persist failed:", error);
  }
}

export async function triggerDownload({ data, filenameOutput, recentContext }: {
  data: Uint8Array;
  filenameOutput: string;
  recentContext?: RecentContext;
}) {
  const mimeType = getMimeType(filenameOutput) || "application/octet-stream";
  const filename = getCompatibleFilename(filenameOutput);
  const blob = new Blob([new Uint8Array(data)], { type: mimeType });
  const blobUrl = URL.createObjectURL(blob);
  blobUrlsPendingRevocation.set(blobUrl, blob);

  if (import.meta.env.FIREFOX) {
    const downloadId = await browser.downloads.download({
      url: blobUrl,
      filename
    });
    if (recentContext) {
      void persistFirefoxRecentDownload({
        downloadId,
        blobUrl,
        mimeType,
        filename,
        recentContext
      });
    }
  } else {
    for (let i = 0; i < DOWNLOAD_MAX_RETRIES; i++) {
      try {
        await sendMessage(MessageType.PipelineDownload, {
          blobUrl,
          mimeType,
          filename,
          recentContext
        });
        break;
      } catch {
        await new Promise(resolve => setTimeout(resolve, DOWNLOAD_RETRY_INTERVAL_MS));
      }
    }
  }

  setTimeout(() => {
    URL.revokeObjectURL(blobUrl);
    blobUrlsPendingRevocation.delete(blobUrl);
  }, BLOB_REVOCATION_DELAY_MS);
}
