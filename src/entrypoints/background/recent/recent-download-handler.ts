import { getTabIdsForVideo } from "../queue/tab-tracker";
import { MessageType, onMessage, sendMessage } from "@/lib/messaging/messaging";
import type { PipelineDownloadMessage } from "@/lib/messaging/messaging";
import { addRecentDownload } from "@/lib/storage/recent-downloads-db";
import { optionsItem } from "@/lib/storage/storage";
import type { RecentDownloadEntry } from "@/types";

async function isTabIdle(tabId: number) {
  try {
    const tab = await browser.tabs.get(tabId);
    if (!tab.active) {
      return true;
    }

    const win = await browser.windows.get(tab.windowId);
    return !win.focused;
  } catch {
    return true;
  }
}

function persistOnDownloadComplete({ targetDownloadId, data }: {
  targetDownloadId: number;
  data: PipelineDownloadMessage;
}) {
  return new Promise<void>(resolve => {
    async function handleChanged(delta: Browser.downloads.DownloadDelta) {
      if (delta.id !== targetDownloadId || !delta.state?.current) {
        return;
      }

      if (delta.state.current === browser.downloads.State.COMPLETE) {
        browser.downloads.onChanged.removeListener(handleChanged);

        const tabIds = data.recentContext?.videoId
          ? getTabIdsForVideo(data.recentContext.videoId)
          : [];

        for (const tabId of tabIds) {
          void sendMessage(MessageType.WatchDownloadCompleted, {
            videoId: data.recentContext!.videoId,
            downloadId: targetDownloadId,
            filename: data.filename
          }, tabId);
        }

        const options = await optionsItem.getValue();
        if (options.isRevealOnComplete) {
          browser.downloads.show(targetDownloadId);
        }

        if (options.isNotifyOnIdle) {
          const [tabId] = tabIds;
          const isIdle = tabId === undefined || await isTabIdle(tabId);
          if (isIdle) {
            void browser.notifications.create({
              type: "basic",
              iconUrl: browser.runtime.getURL("/icons/128.png"),
              title: "Download complete",
              message: data.filename
            });
          }
        }

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
      audioMimeType: context.audioMimeType,
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
      // Popup not open - ignore.
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

  onMessage(MessageType.RevealDownloadFile, ({ data }) => {
    browser.downloads.show(data.downloadId);
  });
}
