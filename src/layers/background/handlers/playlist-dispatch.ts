import { reportDownloadFailed } from "../download/background-downloader";
import { awaitBytesTransferred, awaitVideoComplete } from "../queue/sequential-queue";
import { MessageType, sendMessageToTab } from "@/lib/messaging/messaging";
import { createLogger, LogScope } from "@/lib/utils/logger";
import type { DownloadRequest, Prettify } from "@/types";

const log = createLogger(LogScope.Background);

type DispatchParams = Prettify<{
  items: DownloadRequest[];
  tabId: number;
  signal: AbortSignal;
}>;
export async function dispatchSequentially({ items, tabId, signal }: DispatchParams) {
  for (const item of items) {
    if (signal.aborted) {
      break;
    }

    let triggered = false;
    try {
      await sendMessageToTab(MessageType.ExecuteDownloadItem, item, tabId);
      await sendMessageToTab(MessageType.StartKeepalive, { videoId: item.videoId }, tabId);
      triggered = true;
    } catch (error) {
      log.error("ExecuteDownloadItem failed:", item.videoId, error);
      await reportDownloadFailed({
        videoId: item.videoId,
        tabId
      });
    }

    if (triggered) {
      await awaitVideoComplete(item.videoId);
    }
  }
}

export async function dispatchParallel({ items, tabId, signal }: DispatchParams) {
  const completionPromises: Promise<void>[] = [];

  for (const item of items) {
    if (signal.aborted) {
      break;
    }

    try {
      await sendMessageToTab(MessageType.ExecuteDownloadItem, item, tabId);
      await sendMessageToTab(MessageType.StartKeepalive, { videoId: item.videoId }, tabId);
    } catch (error) {
      log.error("ExecuteDownloadItem failed:", item.videoId, error);
      await reportDownloadFailed({
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
