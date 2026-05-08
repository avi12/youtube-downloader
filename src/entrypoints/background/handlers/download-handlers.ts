import { cancelBackgroundDownload, dropPendingRetry, startBackgroundDownload } from "../download/background-downloader";
import { enqueueToPopupList, removeFromPopupList } from "../queue/popup-list";
import { awaitBytesTransferred, awaitVideoComplete, signalVideoComplete } from "../queue/sequential-queue";
import { cancelDownloads, getTabIdsForVideo, trackVideoForTab } from "../queue/tab-tracker";
import { ensureProcessor } from "./processor";
import { markVideosCancelled } from "./pipeline-handlers";
import { MessageType, onMessage, sendMessage } from "@/lib/messaging/messaging";
import { OffscreenMessageType, sendToOffscreen } from "@/lib/messaging/offscreen-messaging";
import { uint8ToBase64 } from "@/lib/utils/binary";
import { ProgressType } from "@/types";
import type { DownloadRequest } from "@/types";

const IFRAME_READY_TIMEOUT_MS = 30_000;

// Per-videoId resolve callbacks waiting for the offscreen iframe to finish booting.
// @webext-core/messaging allows only one listener per type per context, so this
// registers once and dispatches to the right resolver.
const pendingIframeReady = new Map<string, () => void>();

function initIframeReadyListener() {
  onMessage(MessageType.DownloadIframeReady, ({ data }) => {
    pendingIframeReady.get(data.videoId)?.();
    pendingIframeReady.delete(data.videoId);
  });
}

async function prepareIframe(data: DownloadRequest) {
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

    pendingIframeReady.set(data.videoId, () => {
      clearTimeout(timeoutId);
      resolve();
    });
  });
}

async function executeIframeDownload({ data, tabId }: {
  data: DownloadRequest;
  tabId: number;
}) {
  // Broadcast: the offscreen iframe filters by ?ytdl=1 + matching videoId in its content script.
  await sendMessage(MessageType.ExecuteDownloadItem, data);
  trackVideoForTab({
    videoId: data.videoId,
    tabId
  });
  await sendMessage(MessageType.StartKeepalive, { videoId: data.videoId }, tabId);
}

async function downloadViaWatchPage({ data, tabId }: {
  data: DownloadRequest;
  tabId: number;
}) {
  await enqueueToPopupList({
    videoId: data.videoId,
    type: data.type,
    filenameOutput: data.filenameOutput
  });

  try {
    await prepareIframe(data);
    await executeIframeDownload({
      data,
      tabId
    });
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

async function dispatchSequentially({ items, tabId, signal }: {
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
    sendToOffscreen(OffscreenMessageType.RemoveDownloadIframe, { videoId: item.videoId });
  }
}

async function dispatchParallel({ items, tabId, signal }: {
  items: DownloadRequest[];
  tabId: number;
  signal: AbortSignal;
}) {
  const completionPromises: Promise<void>[] = [];

  for (const item of items) {
    if (signal.aborted) {
      break;
    }

    await prepareIframe(item).catch(() => undefined);

    try {
      await executeIframeDownload({
        data: item,
        tabId
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
      awaitVideoComplete(item.videoId).then(() =>
        sendToOffscreen(OffscreenMessageType.RemoveDownloadIframe, { videoId: item.videoId }))
    );

    // Wait only until bytes are in the offscreen doc before starting
    // the next download - allows muxing phases to overlap while still
    // preventing concurrent SABR sessions.
    await awaitBytesTransferred(item.videoId);
  }

  await Promise.all(completionPromises);
}

let currentSequenceAbort: AbortController | null = null;
let currentSequenceTabId: number | null = null;

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

      const responseHeaders: Record<string, string> = {};
      for (const [key, value] of response.headers) {
        responseHeaders[key] = value;
      }

      return {
        status: response.status,
        bodyBase64: uint8ToBase64(responseBytes),
        responseHeaders
      };
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

    void downloadViaWatchPage({
      data,
      tabId: originTabId
    });
  });

  onMessage(MessageType.Keepalive, () => {});

  onMessage(MessageType.RequestPlaylistDownload, async ({ data, sender }) => {
    const tabId = sender.tab?.id;
    if (!tabId) {
      return;
    }

    currentSequenceAbort?.abort();
    currentSequenceAbort = null;
    currentSequenceTabId = tabId;

    for (const item of data.items) {
      await enqueueToPopupList({
        videoId: item.videoId,
        type: item.type,
        filenameOutput: item.filenameOutput
      });
    }

    currentSequenceAbort = new AbortController();

    if (data.isSequential) {
      void dispatchSequentially({
        items: data.items,
        tabId,
        signal: currentSequenceAbort.signal
      });
    } else {
      void dispatchParallel({
        items: data.items,
        tabId,
        signal: currentSequenceAbort.signal
      });
    }
  });

  onMessage(MessageType.CancelDownload, ({ data }) => {
    currentSequenceAbort?.abort();
    currentSequenceAbort = null;
    markVideosCancelled(data.videoIds);

    const progressRemoval = {
      progress: 0,
      progressType: ProgressType.Video,
      isRemoved: true
    } as const;

    for (const videoId of data.videoIds) {
      cancelBackgroundDownload(videoId);
      dropPendingRetry(videoId);
      signalVideoComplete(videoId);
      const trackedTabIds = getTabIdsForVideo(videoId);
      sendToOffscreen(OffscreenMessageType.RemoveDownloadIframe, { videoId });
      for (const tabId of trackedTabIds) {
        void sendMessage(MessageType.UpdateDownloadProgress, {
          videoId,
          ...progressRemoval
        }, tabId);
      }

      if (currentSequenceTabId && !trackedTabIds.includes(currentSequenceTabId)) {
        void sendMessage(MessageType.UpdateDownloadProgress, {
          videoId,
          ...progressRemoval
        }, currentSequenceTabId);
      }
    }

    currentSequenceTabId = null;
    void removeFromPopupList(data.videoIds);
    void cancelDownloads(data.videoIds);
  });

  onMessage(MessageType.StartBackgroundDownload, async ({ data, sender }) => {
    const tabId = sender.tab?.id ?? getTabIdsForVideo(data.videoId)[0] ?? -1;
    trackVideoForTab({
      videoId: data.videoId,
      tabId
    });
    await enqueueToPopupList({
      videoId: data.videoId,
      type: data.type,
      filenameOutput: data.filenameOutput
    });
    void startBackgroundDownload({
      request: data,
      tabId
    });
    await sendMessage(MessageType.StartKeepalive, { videoId: data.videoId }, tabId);
  });
}
