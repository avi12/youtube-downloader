import { removeHostedIframe } from "../iframe-host/iframe-host";
import { enqueueToPopupList, removeFromPopupList } from "../queue/popup-list";
import { trackVideoForTab } from "../queue/tab-tracker";
import { deletePendingIframeReady, prepareIframe } from "./iframe-ready-tracker";
import { MessageType, sendMessage } from "@/lib/messaging/messaging";
import { OffscreenMessageType, sendToOffscreen } from "@/lib/messaging/offscreen-messaging";
import { ProgressType } from "@/types";
import type { DownloadRequest } from "@/types";

export { initIframeReadyListener, prepareIframe } from "./iframe-ready-tracker";
export { dispatchSequentially, dispatchParallel } from "./iframe-dispatch";

const DOWNLOAD_IFRAME_ID_PREFIX = "dl-";

export function downloadIframeId(videoId: string) {
  return `${DOWNLOAD_IFRAME_ID_PREFIX}${videoId}`;
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
    deletePendingIframeReady(data.videoId);
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
