import { removeHostedIframe } from "../iframe-host/iframe-host";
import { removeFromPopupList } from "../queue/popup-list";
import { awaitBytesTransferred, awaitVideoComplete } from "../queue/sequential-queue";
import { downloadIframeId, downloadViaWatchPage, executeIframeDownload, prepareIframe } from "./iframe-download";
import { MessageType, sendMessage } from "@/lib/messaging/messaging";
import { ProgressType } from "@/types";
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
    await awaitVideoComplete(item.videoId);
    removeHostedIframe(downloadIframeId(item.videoId));
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

    let iframeTabId: number | undefined;
    let iframeFrameId = 0;
    const prepared = await prepareIframe({ data: item }).catch(() => null);
    if (prepared) {
      iframeTabId = prepared.iframeTabId;
      iframeFrameId = prepared.iframeFrameId;
    }

    try {
      await executeIframeDownload({
        data: item,
        originTabId: tabId,
        iframeTabId,
        iframeFrameId
      });
    } catch (error) {
      console.error("[ytdl:bg] executeIframeDownload failed:", item.videoId, error);
      void removeFromPopupList(item.videoId);
      void sendMessage(MessageType.UpdateDownloadProgress, {
        videoId: item.videoId,
        progress: 0,
        progressType: ProgressType.Video,
        isRemoved: true
      }, tabId);
    }

    completionPromises.push(
      awaitVideoComplete(item.videoId).then(() => {
        removeHostedIframe(downloadIframeId(item.videoId));
      })
    );

    await awaitBytesTransferred(item.videoId);
  }

  await Promise.all(completionPromises);
}
