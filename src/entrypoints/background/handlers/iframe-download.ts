import { removeHostedIframe, spawnHostedIframe } from "../iframe-host/iframe-host";
import { enqueueToPopupList, removeFromPopupList } from "../queue/popup-list";
import { awaitBytesTransferred, awaitVideoComplete } from "../queue/sequential-queue";
import { trackVideoForTab } from "../queue/tab-tracker";
import { MessageType, onMessage, sendMessage } from "@/lib/messaging/messaging";
import { OffscreenMessageType, sendToOffscreen } from "@/lib/messaging/offscreen-messaging";
import { ProgressType } from "@/types";
import type { DownloadRequest } from "@/types";

const IFRAME_READY_TIMEOUT_MS = 30_000;
const DOWNLOAD_IFRAME_ID_PREFIX = "dl-";

export function downloadIframeId(videoId: string) {
  return `${DOWNLOAD_IFRAME_ID_PREFIX}${videoId}`;
}

const pendingIframeReady = new Map<string, (tabId: number | undefined, frameId: number) => void>();

export function initIframeReadyListener() {
  onMessage(MessageType.DownloadIframeReady, ({ data, sender }) => {
    pendingIframeReady.get(data.videoId)?.(sender.tab?.id, sender.frameId ?? 0);
    pendingIframeReady.delete(data.videoId);
  });
}

export async function prepareIframe({ data }: {
  data: DownloadRequest;
}): Promise<{
  iframeTabId: number | undefined;
  iframeFrameId: number;
}> {
  const watchParams = new URLSearchParams({
    v: data.videoId,
    ytdl: "1",
    mute: "1"
  });
  const watchUrl = `https://www.youtube.com/watch?${watchParams.toString()}`;

  await spawnHostedIframe({
    id: downloadIframeId(data.videoId),
    url: watchUrl
  });

  let iframeTabId: number | undefined;
  let iframeFrameId = 0;

  await new Promise<void>(resolve => {
    const timeoutId = setTimeout(() => {
      pendingIframeReady.delete(data.videoId);
      resolve();
    }, IFRAME_READY_TIMEOUT_MS);

    pendingIframeReady.set(data.videoId, (tabId, frameId) => {
      iframeTabId = tabId;
      iframeFrameId = frameId;
      clearTimeout(timeoutId);
      resolve();
    });
  });

  return {
    iframeTabId,
    iframeFrameId
  };
}

export async function executeIframeDownload({ data, originTabId, iframeTabId, iframeFrameId }: {
  data: DownloadRequest;
  originTabId: number;
  iframeTabId: number | undefined;
  iframeFrameId: number;
}) {
  if (iframeTabId !== undefined) {
    await sendMessage(MessageType.ExecuteDownloadItem, data, {
      tabId: iframeTabId,
      frameId: iframeFrameId
    });
  } else {
    sendToOffscreen(OffscreenMessageType.ForwardToIframe, {
      iframeId: downloadIframeId(data.videoId),
      payload: data
    });
  }

  trackVideoForTab({
    videoId: data.videoId,
    tabId: originTabId
  });
  await sendMessage(MessageType.StartKeepalive, { videoId: data.videoId }, originTabId);
}

export async function downloadViaWatchPage({ data, tabId }: {
  data: DownloadRequest;
  tabId: number;
}) {
  await enqueueToPopupList({
    videoId: data.videoId,
    type: data.type,
    filenameOutput: data.filenameOutput
  });

  try {
    const { iframeTabId, iframeFrameId } = await prepareIframe({ data });
    await executeIframeDownload({
      data,
      originTabId: tabId,
      iframeTabId,
      iframeFrameId
    });
  } catch (error) {
    console.error("[ytdl:bg] DownloadViaWatchPage failed:", data.videoId, error);
    pendingIframeReady.delete(data.videoId);
    void removeFromPopupList(data.videoId);
    removeHostedIframe(downloadIframeId(data.videoId));
    void sendMessage(MessageType.UpdateDownloadProgress, {
      videoId: data.videoId,
      progress: 0,
      progressType: ProgressType.Video,
      isRemoved: true
    }, tabId);
  }
}

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
