import { reportDownloadFailed } from "../download/background-downloader";
import { awaitBytesTransferred, awaitVideoComplete } from "../queue/sequential-queue";
import { MessageType, sendMessage } from "@/lib/messaging/messaging";
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

    let triggered = false;
    try {
      await sendMessage(MessageType.ExecuteDownloadItem, item, tabId);
      void sendMessage(MessageType.StartKeepalive, { videoId: item.videoId }, tabId);
      triggered = true;
    } catch (error) {
      console.error("[ytdl:bg] ExecuteDownloadItem failed:", item.videoId, error);
      reportDownloadFailed({
        videoId: item.videoId,
        tabId
      });
    }

    if (triggered) {
      await awaitVideoComplete(item.videoId);
    }
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

    try {
      await sendMessage(MessageType.ExecuteDownloadItem, item, tabId);
      void sendMessage(MessageType.StartKeepalive, { videoId: item.videoId }, tabId);
    } catch (error) {
      console.error("[ytdl:bg] ExecuteDownloadItem failed:", item.videoId, error);
      reportDownloadFailed({
        videoId: item.videoId,
        tabId
      });
      continue;
    }

    completionPromises.push(awaitVideoComplete(item.videoId));
    await awaitBytesTransferred(item.videoId);
  }

  await Promise.all(completionPromises);
}
