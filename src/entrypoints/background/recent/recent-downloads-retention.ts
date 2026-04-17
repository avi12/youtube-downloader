import { ensureProcessor } from "../handlers/processor";
import { MessageType, onMessage } from "@/lib/messaging/messaging";
import { OffscreenMessageType, sendToOffscreen } from "@/lib/messaging/offscreen-messaging";
import { pruneRecentDownloads } from "@/lib/storage/recent-downloads-db";

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
    if (alarm.name !== RETENTION_ALARM_NAME || openPopupCount > 0) {
      return;
    }

    void prune();
  });

  onMessage(MessageType.TranscodeRecentDownload, async ({ data }) => {
    await ensureProcessor();
    sendToOffscreen(OffscreenMessageType.TranscodeRecentDownload, data);
  });
}
