import { ensureProcessor } from "../handlers/processor";
import { enqueueToPopupList } from "../queue/popup-list";
import { MessageType, onMessage } from "@/lib/messaging/messaging";
import { OffscreenMessageType, sendToOffscreen } from "@/lib/messaging/offscreen-messaging";
import { pruneRecentDownloads } from "@/lib/storage/recent-downloads-db";
import { DownloadType } from "@/types";

const RETENTION_ALARM_NAME = "ytdl-prune-recent-downloads";
const RETENTION_DURATION_MS = 10 * 60 * 1000;
const POPUP_PORT_NAME = "popup";

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

  void browser.alarms.create(RETENTION_ALARM_NAME, { periodInMinutes: 1 });
  browser.alarms.onAlarm.addListener(alarm => {
    const isNotRetentionAlarm = alarm.name !== RETENTION_ALARM_NAME;
    const isPopupOpen = openPopupCount > 0;
    if (isNotRetentionAlarm || isPopupOpen) {
      return;
    }

    void prune();
  });

  onMessage(MessageType.TranscodeRecentDownload, async ({ data }) => {
    await ensureProcessor();
    await enqueueToPopupList({
      videoId: `transcode:${data.entryId}`,
      type: DownloadType.VideoAndAudio,
      filenameOutput: data.filenameOutput
    });
    sendToOffscreen({
      type: OffscreenMessageType.TranscodeRecentDownload,
      data
    });
  });
}
