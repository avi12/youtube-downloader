import { reportDownloadFailed } from "../download/background-downloader";
import { downloadViaWatchPage, prepareIframe } from "../download/iframe-downloader";
import { awaitBytesTransferred, awaitVideoComplete } from "../queue/sequential-queue";
import { trackVideoForTab } from "../queue/tab-tracker";
import { MessageType, sendMessage } from "@/lib/messaging/messaging";
import { OffscreenMessageType, sendToOffscreen } from "@/lib/messaging/offscreen-messaging";
import type { DownloadRequest } from "@/types";

export async function dispatchSequentially({ items, tabId, signal }: {
  items: DownloadRequest[];
  tabId: number;
  signal: AbortSignal;
}) {
  for (const item of items) {
    if (signal.aborted) {
      break;
    }

    await downloadViaWatchPage({
      data: item,
      tabId
    });
  }
}

export async function dispatchParallel({ items, tabId, signal }: {
  items: DownloadRequest[];
  tabId: number;
  signal: AbortSignal;
}) {
  const completionPromises: Promise<void>[] = [];

  for (const item of items) {
    if (signal.aborted) {
      break;
    }

    trackVideoForTab({
      videoId: item.videoId,
      tabId
    });

    try {
      await prepareIframe({
        ...item,
        isIframeFallback: true
      });
      void sendMessage(MessageType.StartKeepalive, { videoId: item.videoId }, tabId);
    } catch (error) {
      console.error("[ytdl:bg] prepareIframe failed:", item.videoId, error);
      reportDownloadFailed({
        videoId: item.videoId,
        tabId
      });
    }

    completionPromises.push(
      awaitVideoComplete(item.videoId).then(() =>
        sendToOffscreen({
          type: OffscreenMessageType.RemoveDownloadIframe,
          data: {
            videoId: item.videoId
          }
        }))
    );

    await awaitBytesTransferred(item.videoId);
  }

  await Promise.all(completionPromises);
}
