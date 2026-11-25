import { reportDownloadFailed } from "@/layers/background/download/background-downloader";
import { awaitVideoComplete } from "@/layers/background/queue/sequential-queue";
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

    let isTriggered = false;
    try {
      await sendMessageToTab({
         type: MessageType.ExecuteDownloadItem,
         data: item,
         tabId 
      });
      await sendMessageToTab({
         type: MessageType.StartKeepalive,
         data: {
         videoId: item.videoId 
      },
         tabId 
      });
      isTriggered = true;
    } catch (error) {
      log.error("ExecuteDownloadItem failed:", item.videoId, error);
      await reportDownloadFailed({
        videoId: item.videoId,
        tabId
      });
    }

    if (isTriggered) {
      await awaitVideoComplete({ videoId: item.videoId });
    }
  }
}

// Every video gets its download signal at once; each runs on its own and finishes on its own
export async function dispatchParallel({ items, tabId, signal }: DispatchParams) {
  await Promise.all(
    items.map(async item => {
      if (signal.aborted) {
        return;
      }

      try {
        await sendMessageToTab({
          type: MessageType.ExecuteDownloadItem,
          data: item,
          tabId
        });
        await sendMessageToTab({
          type: MessageType.StartKeepalive,
          data: {
            videoId: item.videoId
          },
          tabId
        });
      } catch (error) {
        log.error("ExecuteDownloadItem failed:", item.videoId, error);
        await reportDownloadFailed({
          videoId: item.videoId,
          tabId
        });
        return;
      }

      await awaitVideoComplete({ videoId: item.videoId });
    })
  );
}
