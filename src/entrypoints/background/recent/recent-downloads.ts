import { ensureProcessor } from "../handlers/processor";
import { enqueueToPopupList } from "../queue/popup-list";
import { getTabIdsForVideo } from "../queue/tab-tracker";
import { TRANSCODE_VIDEO_ID_PREFIX } from "@/lib/download-pipeline/transcode-recent";
import { MessageType, onMessage, sendMessage } from "@/lib/messaging/messaging";
import type { PipelineDownloadMessage } from "@/lib/messaging/messaging";
import { OffscreenMessageType, sendToOffscreen } from "@/lib/messaging/offscreen-messaging";
import { addRecentDownload, pruneRecentDownloads } from "@/lib/storage/recent-downloads-db";
import { optionsItem } from "@/lib/storage/storage";
import { getFileExtension } from "@/lib/utils/containers";
import { DownloadType } from "@/types";

export async function persistRecentDownload({ downloadId, data }: {
  downloadId: number;
  data: PipelineDownloadMessage;
}) {
  const context = data.recentContext;
  if (!context) {
    return;
  }

  try {
    const response = await fetch(data.blobUrl);
    const blob = await response.blob();
    await addRecentDownload({
      entry: {
        id: crypto.randomUUID(),
        downloadId,
        videoId: context.videoId,
        title: context.title,
        channel: context.channel,
        filename: data.filename,
        container: getFileExtension(data.filename),
        mimeType: data.mimeType,
        videoMimeType: context.videoMimeType,
        audioMimeType: context.audioMimeType,
        size: blob.size,
        thumbnailUrl: context.thumbnailUrl,
        completedAt: Date.now()
      },
      blob
    });
    try {
      await sendMessage(MessageType.RecentDownloadsChanged);
    } catch {
      // Popup not open - ignore.
    }
  } catch (error) {
    console.warn("[ytdl:bg] Persist recent download failed:", error);
  }
}

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
  if (!isIdle) {
    return;
  }

  void browser.notifications.create({
    type: NOTIFICATION_TYPE,
    iconUrl: browser.runtime.getURL(NOTIFICATION_ICON_PATH),
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

function scheduleRevokeBlobUrl({ downloadId, blobUrl }: {
  downloadId: number;
  blobUrl: string;
}) {
  function handleChanged(delta: Browser.downloads.DownloadDelta) {
    const isUnrelatedOrIncomplete = delta.id !== downloadId || !delta.state?.current;
    if (isUnrelatedOrIncomplete) {
      return;
    }

    const { current } = delta.state!;
    const isTerminal = current === browser.downloads.State.COMPLETE
      || current === browser.downloads.State.INTERRUPTED;
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

    if (data.recentContext) {
      void persistOnDownloadComplete({
        downloadId,
        data
      });
    }
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
        void prune();
      }
    });
  });

  void browser.alarms.create(RETENTION_ALARM_NAME, { periodInMinutes: RETENTION_ALARM_PERIOD_MINUTES });
  browser.alarms.onAlarm.addListener(alarm => {
    const isRetentionAlarm = alarm.name === RETENTION_ALARM_NAME;
    const isPopupOpen = openPopupCount > 0;
    if (!isRetentionAlarm || isPopupOpen) {
      return;
    }

    void prune();
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
