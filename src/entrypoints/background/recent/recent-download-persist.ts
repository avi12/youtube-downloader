import { getTabIdsForVideo } from "../queue/tab-tracker";
import { persistRecentDownload } from "./recent-download-storage";
import { MessageType, sendMessage } from "@/lib/messaging/messaging";
import type { PipelineDownloadMessage } from "@/lib/messaging/messaging";
import { optionsItem } from "@/lib/storage/storage";

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

async function notifyOnIdleIfNeeded({ data, tabIds }: {
  data: PipelineDownloadMessage;
  tabIds: number[];
}) {
  const [tabId] = tabIds;
  const isIdle = tabId === undefined || await isTabIdle(tabId);
  const isNotIdle = !isIdle;
  if (isNotIdle) {
    return;
  }

  void browser.notifications.create({
    type: "basic",
    iconUrl: browser.runtime.getURL("/icons/128.png"),
    title: "Download complete",
    message: data.filename
  });
}

export function persistOnDownloadComplete({ downloadId, data }: {
  downloadId: number;
  data: PipelineDownloadMessage;
}) {
  return new Promise<void>(resolve => {
    async function handleChanged(delta: Browser.downloads.DownloadDelta) {
      const isUnrelatedOrIncomplete = delta.id !== downloadId || !delta.state?.current;
      if (isUnrelatedOrIncomplete) {
        return;
      }

      if (delta.state!.current === browser.downloads.State.COMPLETE) {
        browser.downloads.onChanged.removeListener(handleChanged);

        const tabIds = data.recentContext?.videoId
          ? getTabIdsForVideo(data.recentContext.videoId)
          : [];
        const [downloadItem] = await browser.downloads.search({ id: downloadId });
        const actualFilename = downloadItem?.filename
          ? downloadItem.filename.split(/[/\\]/).pop()!
          : data.filename;

        for (const tabId of tabIds) {
          void sendMessage(MessageType.WatchDownloadCompleted, {
            videoId: data.recentContext!.videoId,
            downloadId,
            filename: actualFilename
          }, tabId);
        }

        const options = await optionsItem.getValue();
        if (options.isRevealOnComplete) {
          browser.downloads.show(downloadId);
        }

        if (options.isNotifyOnIdle) {
          await notifyOnIdleIfNeeded({
            data,
            tabIds
          });
        }

        void persistRecentDownload({
          downloadId,
          data
        }).finally(resolve);
        return;
      }

      if (delta.state!.current === browser.downloads.State.INTERRUPTED) {
        browser.downloads.onChanged.removeListener(handleChanged);
        resolve();
      }
    }

    browser.downloads.onChanged.addListener(handleChanged);
  });
}
