import { cancelBackgroundDownload, startBackgroundDownload } from "../download/background-downloader";
import { enqueueToPopupList, removeFromPopupList } from "../queue/popup-list";
import { awaitVideoComplete, signalVideoComplete } from "../queue/sequential-queue";
import { cancelDownloads, getTabIdsForVideo, trackVideoForTab } from "../queue/tab-tracker";
import { MessageType, onMessage, sendMessage } from "@/lib/messaging/messaging";
import { ProgressType } from "@/types";
import type { DownloadRequest } from "@/types";

const bufferChunkSize = 8192;
const iframeReadyTimeoutMs = 30_000;

// One persistent listener dispatches to per-videoId resolve functions.
// @webext-core/messaging allows only one listener per type per context,
// so registering inside downloadViaWatchPage would throw on the 2nd parallel call.
// Stores the frameId alongside the resolve callback so ExecuteDownloadItem
// can be sent directly to the correct iframe instead of all frames in the tab.
const pendingIframeReady = new Map<string, (frameId: number) => void>();

function initIframeReadyListener() {
  onMessage(MessageType.DownloadIframeReady, ({ data, sender }) => {
    pendingIframeReady.get(data.videoId)?.(sender.frameId ?? 0);
    pendingIframeReady.delete(data.videoId);
  });
}

async function downloadViaWatchPage({ data, tabId }: {
  data: DownloadRequest;
  tabId: number;
}) {
  await enqueueToPopupList({ videoId: data.videoId, type: data.type, filenameOutput: data.filenameOutput });

  try {
    const watchParams = new URLSearchParams({ v: data.videoId, ytdl: "1", mute: "1" });
    const watchUrl = `https://www.youtube.com/watch?${watchParams.toString()}`;

    await sendMessage(MessageType.CreateDownloadIframe, {
      videoId: data.videoId,
      watchUrl
    }, tabId);

    let iframeFrameId = 0;

    await new Promise<void>(resolve => {
      const timeoutId = setTimeout(() => {
        pendingIframeReady.delete(data.videoId);
        resolve();
      }, iframeReadyTimeoutMs);

      pendingIframeReady.set(data.videoId, frameId => {
        iframeFrameId = frameId;
        clearTimeout(timeoutId);
        resolve();
      });
    });

    await sendMessage(MessageType.ExecuteDownloadItem, data, { tabId, frameId: iframeFrameId });

    trackVideoForTab({ videoId: data.videoId, tabId });

    await sendMessage(MessageType.StartKeepalive, { videoId: data.videoId }, tabId);
  } catch (error) {
    console.error("[ytdl:bg] DownloadViaWatchPage failed:", data.videoId, error);
    pendingIframeReady.delete(data.videoId);
    void removeFromPopupList(data.videoId);
    void sendMessage(MessageType.RemoveDownloadIframe, { videoId: data.videoId }, tabId);
    void sendMessage(MessageType.UpdateDownloadProgress, {
      videoId: data.videoId, progress: 0, progressType: ProgressType.Video, isRemoved: true
    }, tabId);
  }
}

async function dispatchSequentially({ items, tabId, signal }: {
  items: DownloadRequest[];
  tabId: number;
  signal: AbortSignal;
}) {
  for (const item of items) {
    if (signal.aborted) {
      break;
    }

    await downloadViaWatchPage({ data: item, tabId });
    await awaitVideoComplete(item.videoId);
    await sendMessage(MessageType.RemoveDownloadIframe, { videoId: item.videoId }, tabId);
  }
}

let currentSequenceAbort: AbortController | null = null;

export function registerDownloadHandlers() {
  initIframeReadyListener();

  // Background SW has host_permissions for googlevideo.com and bypasses CORS preflight;
  // credentials: 'include' attaches any existing googlevideo cookies.
  onMessage(MessageType.BackgroundProxyFetch, async ({ data }) => {
    const { url, method, bodyBase64, headers } = data;

    const bodyBinary = atob(bodyBase64);
    const bodyBytes = new Uint8Array(bodyBinary.length);
    for (let i = 0; i < bodyBinary.length; i++) {
      bodyBytes[i] = bodyBinary.charCodeAt(i);
    }

    try {
      const response = await fetch(url, {
        method,
        body: bodyBytes.length > 0 ? bodyBytes : undefined,
        headers,
        credentials: "include"
      });

      const responseBuffer = await response.arrayBuffer();
      const responseBytes = new Uint8Array(responseBuffer);

      let responseBinary = "";
      for (let i = 0; i < responseBytes.length; i += bufferChunkSize) {
        responseBinary += String.fromCharCode(...responseBytes.subarray(i, i + bufferChunkSize));
      }

      const responseHeaders: Record<string, string> = {};
      for (const [key, value] of response.headers) {
        responseHeaders[key] = value;
      }

      return { status: response.status, bodyBase64: btoa(responseBinary), responseHeaders };
    } catch (fetchError) {
      console.error("[ytdl] BackgroundProxyFetch error:", fetchError);
      return null;
    }
  });

  onMessage(MessageType.DownloadViaWatchPage, ({ data, sender }) => {
    const originTabId = sender.tab?.id;
    if (!originTabId) {
      return;
    }

    void downloadViaWatchPage({ data, tabId: originTabId });
  });

  onMessage(MessageType.Keepalive, () => {});

  onMessage(MessageType.RequestPlaylistDownload, async ({ data, sender }) => {
    const tabId = sender.tab?.id;
    if (!tabId) {
      return;
    }

    currentSequenceAbort?.abort();
    currentSequenceAbort = null;

    for (const item of data.items) {
      await enqueueToPopupList({ videoId: item.videoId, type: item.type, filenameOutput: item.filenameOutput });
    }

    if (data.isSequential) {
      currentSequenceAbort = new AbortController();
      void dispatchSequentially({ items: data.items, tabId, signal: currentSequenceAbort.signal });
    } else {
      void Promise.allSettled(data.items.map(item => downloadViaWatchPage({ data: item, tabId })));
    }
  });

  onMessage(MessageType.CancelDownload, ({ data }) => {
    currentSequenceAbort?.abort();
    currentSequenceAbort = null;

    for (const videoId of data.videoIds) {
      cancelBackgroundDownload(videoId);
      signalVideoComplete(videoId);
      void removeFromPopupList(videoId);
      for (const tabId of getTabIdsForVideo(videoId)) {
        void sendMessage(MessageType.RemoveDownloadIframe, { videoId }, tabId);
      }
    }

    void cancelDownloads(data.videoIds);
  });

  onMessage(MessageType.StartBackgroundDownload, async ({ data, sender }) => {
    const tabId = sender.tab?.id ?? -1;
    trackVideoForTab({ videoId: data.videoId, tabId });
    void startBackgroundDownload({ request: data, tabId });
    await sendMessage(MessageType.StartKeepalive, { videoId: data.videoId }, tabId);
  });
}
