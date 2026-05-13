import { ensureProcessor } from "../handlers/processor";
import { enqueueToPopupList, removeFromPopupList } from "../queue/popup-list";
import { awaitVideoComplete } from "../queue/sequential-queue";
import { trackVideoForTab } from "../queue/tab-tracker";
import { MessageType, onMessage, sendMessage } from "@/lib/messaging/messaging";
import { OffscreenMessageType, sendToOffscreen } from "@/lib/messaging/offscreen-messaging";
import { ProgressType } from "@/types";
import type { DownloadRequest } from "@/types";

const IFRAME_READY_TIMEOUT_MS = 30_000;

const pendingIframeReady = new Map<string, {
  resolve: () => void;
  request: DownloadRequest;
}>();

export function initIframeReadyListener() {
  onMessage(MessageType.DownloadIframeReady, ({ data }) => {
    const pending = pendingIframeReady.get(data.videoId);
    if (!pending) {
      return null;
    }

    pending.resolve();
    pendingIframeReady.delete(data.videoId);
    return pending.request;
  });
}

export async function prepareIframe(data: DownloadRequest) {
  await ensureProcessor();

  const watchParams = new URLSearchParams({
    v: data.videoId,
    ytdl: "1",
    mute: "1"
  });
  const watchUrl = `https://www.youtube.com/watch?${watchParams.toString()}`;

  sendToOffscreen(OffscreenMessageType.CreateDownloadIframe, {
    videoId: data.videoId,
    watchUrl
  });

  await new Promise<void>(resolve => {
    const timeoutId = setTimeout(() => {
      pendingIframeReady.delete(data.videoId);
      resolve();
    }, IFRAME_READY_TIMEOUT_MS);

    pendingIframeReady.set(data.videoId, {
      resolve() {
        clearTimeout(timeoutId);
        resolve();
      },
      request: data
    });
  });
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
  trackVideoForTab({
    videoId: data.videoId,
    tabId
  });

  try {
    await prepareIframe({
      ...data,
      isIframeFallback: true
    });
    await sendMessage(MessageType.StartKeepalive, { videoId: data.videoId }, tabId);
    await awaitVideoComplete(data.videoId);
    sendToOffscreen(OffscreenMessageType.RemoveDownloadIframe, { videoId: data.videoId });
  } catch (error) {
    console.error("[ytdl:bg] DownloadViaWatchPage failed:", data.videoId, error);
    pendingIframeReady.delete(data.videoId);
    void removeFromPopupList(data.videoId);
    sendToOffscreen(OffscreenMessageType.RemoveDownloadIframe, { videoId: data.videoId });
    void sendMessage(MessageType.UpdateDownloadProgress, {
      videoId: data.videoId,
      progress: 0,
      progressType: ProgressType.Video,
      isRemoved: true
    }, tabId);
  }
}
