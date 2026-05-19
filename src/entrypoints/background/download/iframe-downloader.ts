import { ensureProcessor } from "../handlers/processor";
import { enqueueToPopupList } from "../queue/popup-list";
import { awaitVideoComplete } from "../queue/sequential-queue";
import { trackVideoForTab } from "../queue/tab-tracker";
import { reportDownloadFailed } from "./background-downloader";
import { MessageType, onMessage, sendMessage } from "@/lib/messaging/messaging";
import { OffscreenMessageType, sendToOffscreen } from "@/lib/messaging/offscreen-messaging";
import type { DownloadRequest } from "@/types";

const IFRAME_READY_TIMEOUT_MS = 30_000;
const YOUTUBE_WATCH_BASE_URL = "https://www.youtube.com/watch";

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
    mute: "1",
    autoplay: "1"
  });
  const watchUrl = `${YOUTUBE_WATCH_BASE_URL}?${watchParams.toString()}`;

  sendToOffscreen({
    type: OffscreenMessageType.CreateDownloadIframe,
    data: {
      videoId: data.videoId,
      watchUrl
    }
  });

  await new Promise<void>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      pendingIframeReady.delete(data.videoId);
      reject(new Error(`Iframe ready timeout: ${data.videoId}`));
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
    filenameOutput: data.filenameOutput,
    tabId
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

    if (tabId >= 0) {
      await sendMessage(MessageType.StartKeepalive, { videoId: data.videoId }, tabId);
    }

    await awaitVideoComplete(data.videoId);
    sendToOffscreen({
      type: OffscreenMessageType.RemoveDownloadIframe,
      data: {
        videoId: data.videoId
      }
    });
  } catch (error) {
    console.error("[ytdl:bg] DownloadViaWatchPage failed:", data.videoId, error);
    pendingIframeReady.delete(data.videoId);
    sendToOffscreen({
      type: OffscreenMessageType.RemoveDownloadIframe,
      data: {
        videoId: data.videoId
      }
    });
    reportDownloadFailed({
      videoId: data.videoId,
      tabId
    });
  }
}
