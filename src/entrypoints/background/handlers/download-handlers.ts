import { cancelBackgroundDownload, startBackgroundDownload } from "../download/background-downloader";
import { enqueueToPopupList, removeFromPopupList } from "../queue/popup-list";
import { awaitBytesTransferred, awaitVideoComplete, signalVideoComplete } from "../queue/sequential-queue";
import { cancelDownloads, getTabIdsForVideo, trackVideoForTab } from "../queue/tab-tracker";
import { cancelIframeScrubSession } from "./iframe-scrub-orchestrator";
import { markVideosCancelled } from "./pipeline-handlers";
import { MessageType, onMessage, sendMessage } from "@/lib/messaging/messaging";
import { uint8ToBase64 } from "@/lib/utils/binary";
import { ProgressType } from "@/types";
import type { DownloadRequest } from "@/types";

const IFRAME_READY_TIMEOUT_MS = 30_000;

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

// Returns the frameId of the ready iframe, or 0 if timed out.
async function prepareIframe({ data, tabId }: {
  data: DownloadRequest;
  tabId: number;
}): Promise<number> {
  const watchParams = new URLSearchParams({
    v: data.videoId,
    ytdl: "1",
    mute: "1"
  });
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
    }, IFRAME_READY_TIMEOUT_MS);

    pendingIframeReady.set(data.videoId, frameId => {
      iframeFrameId = frameId;
      clearTimeout(timeoutId);
      resolve();
    });
  });

  return iframeFrameId;
}

async function executeIframeDownload({ data, tabId, iframeFrameId }: {
  data: DownloadRequest;
  tabId: number;
  iframeFrameId: number;
}) {
  await sendMessage(MessageType.ExecuteDownloadItem, data, {
    tabId,
    frameId: iframeFrameId
  });
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
    const iframeFrameId = await prepareIframe({
      data,
      tabId
    });
    await executeIframeDownload({
      data,
      tabId,
      iframeFrameId
    });
  } catch (error) {
    console.error("[ytdl:bg] DownloadViaWatchPage failed:", data.videoId, error);
    pendingIframeReady.delete(data.videoId);
    void removeFromPopupList(data.videoId);
    void sendMessage(MessageType.RemoveDownloadIframe, { videoId: data.videoId }, tabId);
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
    await sendMessage(MessageType.RemoveDownloadIframe, { videoId: item.videoId }, tabId);
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

    const iframeFrameId = await prepareIframe({
      data: item,
      tabId
    }).catch(() => 0);

    try {
      await executeIframeDownload({
        data: item,
        tabId,
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
      awaitVideoComplete(item.videoId).then(() =>
        sendMessage(MessageType.RemoveDownloadIframe, {
          videoId: item.videoId
        }, tabId))
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
      void cancelIframeScrubSession(videoId);
      signalVideoComplete(videoId);
      const trackedTabIds = getTabIdsForVideo(videoId);
      for (const tabId of trackedTabIds) {
        void sendMessage(MessageType.RemoveDownloadIframe, { videoId }, tabId);
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
    const tabId = sender.tab?.id ?? -1;
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
