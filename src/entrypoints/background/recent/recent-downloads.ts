import { ensureProcessor } from "../handlers/processor";
import { enqueueToPopupList } from "../queue/popup-list";
import { getTabIdsForVideo } from "../queue/tab-tracker";
import { trackDownloadComplete } from "@/lib/analytics/ga4";
import { TRANSCODE_VIDEO_ID_PREFIX } from "@/lib/download-pipeline/transcode-recent";
import { MessageType, onMessage, sendMessage } from "@/lib/messaging/messaging";
import type { PipelineDownloadMessage } from "@/lib/messaging/messaging";
import { OffscreenMessageType, sendToOffscreen } from "@/lib/messaging/offscreen-messaging";
import { pruneRecentDownloads, touchAllRecentDownloads } from "@/lib/storage/recent-downloads-db";
import { optionsItem } from "@/lib/storage/storage";
import { DownloadType } from "@/types";
import type { Prettify } from "@/types";

type DownloadIdDataParams = Prettify<{
  downloadId: number;
  data: PipelineDownloadMessage;
}>;

async function isTabIdle(tabId: number) {
  try {
    const tab = await browser.tabs.get(tabId);
    if (!tab.active) {
      return true;
    }

    const win = await browser.windows.get(tab.windowId);
    const isWindowUnfocused = !win.focused;
    return isWindowUnfocused;
  } catch {
    return true;
  }
}

type NotifyOnIdleIfNeededParams = Prettify<{
  data: PipelineDownloadMessage;
  tabIds: number[];
}>;
async function notifyOnIdleIfNeeded({ data, tabIds }: NotifyOnIdleIfNeededParams) {
  const [tabId] = tabIds;
  const isTabMissing = tabId === undefined;
  const isIdle = isTabMissing || await isTabIdle(tabId);
  if (!isIdle) {
    return;
  }

  await browser.notifications.create({
    type: NOTIFICATION_TYPE,
    iconUrl: browser.runtime.getURL(NOTIFICATION_ICON_PATH),
    title: "Download complete",
    message: data.filename
  });
}

export function notifyOnDownloadComplete({ downloadId, data }: DownloadIdDataParams) {
  return new Promise<void>(resolve => {
    async function handleChanged(delta: Browser.downloads.DownloadDelta) {
      const isUnrelatedOrIncomplete = delta.id !== downloadId || !delta.state?.current;
      if (isUnrelatedOrIncomplete) {
        return;
      }

      const currentState = delta.state!.current;
      if (currentState === browser.downloads.State.COMPLETE) {
        browser.downloads.onChanged.removeListener(handleChanged);

        const tabIds = data.recentContext?.videoId
          ? getTabIdsForVideo(data.recentContext.videoId)
          : [];
        const [downloadItem] = await browser.downloads.search({ id: downloadId });
        const actualFilename = downloadItem?.filename
          ? downloadItem.filename.split(/[/\\]/).pop()!
          : data.filename;

        for (const tabId of tabIds) {
          await sendMessage(MessageType.WatchDownloadCompleted, {
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

        try {
          await sendMessage(MessageType.RecentDownloadsChanged);
        } catch {
          // Popup not open - ignore.
        }

        resolve();
        return;
      }

      if (currentState === browser.downloads.State.INTERRUPTED) {
        browser.downloads.onChanged.removeListener(handleChanged);
        resolve();
      }
    }

    browser.downloads.onChanged.addListener(handleChanged);
  });
}

type ScheduleRevokeBlobUrlParams = Prettify<{
  downloadId: number;
  blobUrl: string;
}>;
function scheduleRevokeBlobUrl({ downloadId, blobUrl }: ScheduleRevokeBlobUrlParams) {
  function handleChanged(delta: Browser.downloads.DownloadDelta) {
    const isUnrelatedOrIncomplete = delta.id !== downloadId || !delta.state?.current;
    if (isUnrelatedOrIncomplete) {
      return;
    }

    const { current } = delta.state!;
    const isComplete = current === browser.downloads.State.COMPLETE;
    const isInterrupted = current === browser.downloads.State.INTERRUPTED;
    const isTerminal = isComplete || isInterrupted;
    if (!isTerminal) {
      return;
    }

    browser.downloads.onChanged.removeListener(handleChanged);
    sendToOffscreen({
      type: OffscreenMessageType.RevokeBlobUrl,
      data: {
        blobUrl
      }
    });
  }

  browser.downloads.onChanged.addListener(handleChanged);
}

export function trackDownloadCompleteOnce(downloadId: number) {
  function handleChanged(delta: Browser.downloads.DownloadDelta) {
    const isUnrelatedOrIncomplete = delta.id !== downloadId || !delta.state?.current;
    if (isUnrelatedOrIncomplete) {
      return;
    }

    const { current } = delta.state!;
    const isComplete = current === browser.downloads.State.COMPLETE;
    const isTerminal = isComplete || current === browser.downloads.State.INTERRUPTED;
    if (!isTerminal) {
      return;
    }

    browser.downloads.onChanged.removeListener(handleChanged);

    if (isComplete) {
      trackDownloadComplete().catch(() => {});
    }
  }

  browser.downloads.onChanged.addListener(handleChanged);
}

type NotifyWatchTabsParams = Prettify<{
  downloadId: number;
  videoId: string;
  filename: string;
}>;

export function notifyWatchTabsOnComplete({ downloadId, videoId, filename }: NotifyWatchTabsParams) {
  async function handleChanged(delta: Browser.downloads.DownloadDelta) {
    const isUnrelated = delta.id !== downloadId || !delta.state?.current;
    if (isUnrelated) {
      return;
    }

    const { current } = delta.state!;
    const isComplete = current === browser.downloads.State.COMPLETE;
    const isTerminal = isComplete || current === browser.downloads.State.INTERRUPTED;
    if (!isTerminal) {
      return;
    }

    browser.downloads.onChanged.removeListener(handleChanged);

    if (!isComplete) {
      return;
    }

    const tabIds = getTabIdsForVideo(videoId);
    const [downloadItem] = await browser.downloads.search({ id: downloadId });
    const actualFilename = downloadItem?.filename
      ? downloadItem.filename.split(/[/\\]/).pop()!
      : filename;

    for (const tabId of tabIds) {
      await sendMessage(MessageType.WatchDownloadCompleted, {
        videoId,
        downloadId,
        filename: actualFilename
      }, tabId);
    }

    const options = await optionsItem.getValue();
    if (options.isRevealOnComplete) {
      browser.downloads.show(downloadId);
    }
  }

  browser.downloads.onChanged.addListener(handleChanged);
}

export function registerRecentDownloadHandlers() {
  onMessage(MessageType.PipelineDownload, async ({ data }) => {
    const downloadId = await browser.downloads.download({
      url: data.blobUrl,
      filename: data.filename
    });
    scheduleRevokeBlobUrl({
      downloadId,
      blobUrl: data.blobUrl
    });
    trackDownloadCompleteOnce(downloadId);

    if (data.recentContext) {
      await notifyOnDownloadComplete({
        downloadId,
        data
      });
    }

    return { downloadId };
  });

  onMessage(MessageType.RevealDownloadFile, ({ data }) => {
    browser.downloads.show(data.downloadId);
  });
}

const RETENTION_ALARM_NAME = "ytdl-prune-recent-downloads";
const RETENTION_DURATION_MS = 10 * 60 * 1000;
const RETENTION_ALARM_PERIOD_MINUTES = 1;
const POPUP_PORT_NAME = "popup";
const NOTIFICATION_ICON_PATH = "/icons/128.png";
const NOTIFICATION_TYPE = "basic";

let openPopupCount = 0;

async function prune() {
  const threshold = Date.now() - RETENTION_DURATION_MS;
  await pruneRecentDownloads({
    olderThanTimestamp: threshold,
    protectedIds: new Set()
  });
}

export function registerRecentDownloadsRetention() {
  browser.runtime.onConnect.addListener(port => {
    if (port.name !== POPUP_PORT_NAME) {
      return;
    }

    openPopupCount++;
    port.onDisconnect.addListener(() => {
      openPopupCount = Math.max(0, openPopupCount - 1);

      if (openPopupCount === 0) {
        // Restart each download's 10-minute retention from when the popup closed;
        // the periodic alarm prunes them once that fresh window elapses.
        touchAllRecentDownloads().catch(() => {});
      }
    });
  });

  browser.alarms.create(RETENTION_ALARM_NAME, { periodInMinutes: RETENTION_ALARM_PERIOD_MINUTES }).catch(() => {});
  browser.alarms.onAlarm.addListener(alarm => {
    const isRetentionAlarm = alarm.name === RETENTION_ALARM_NAME;
    const isPopupOpen = openPopupCount > 0;
    const shouldSkipPrune = !isRetentionAlarm || isPopupOpen;
    if (shouldSkipPrune) {
      return;
    }

    prune().catch(() => {});
  });

  onMessage(MessageType.TranscodeRecentDownload, async ({ data }) => {
    await ensureProcessor();
    await enqueueToPopupList({
      videoId: `${TRANSCODE_VIDEO_ID_PREFIX}${data.entryId}`,
      type: DownloadType.VideoAndAudio,
      filenameOutput: data.filenameOutput
    });
    sendToOffscreen({
      type: OffscreenMessageType.TranscodeRecentDownload,
      data
    });
  });
}
