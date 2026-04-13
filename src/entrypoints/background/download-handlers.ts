import { cancelBackgroundDownload, startBackgroundDownload } from "./background-downloader";
import { awaitVideoComplete } from "./sequential-queue";
import { cancelDownloads, trackVideoForTab } from "./tab-tracker";
import { MessageType, onMessage, sendMessage } from "@/lib/messaging";
import { ProgressType } from "@/types";
import type { DownloadRequest } from "@/types";

const bufferChunkSize = 8192;

async function dispatchSequentially(items: DownloadRequest[], tabId: number) {
  for (const item of items) {
    await sendMessage(MessageType.ExecuteDownloadItem, item, tabId);
    await awaitVideoComplete(item.videoId);
  }
}

export function registerDownloadHandlers() {
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

  onMessage(MessageType.DownloadViaWatchPage, async ({ data, sender }) => {
    const originTabId = sender.tab?.id;
    if (!originTabId) {
      return;
    }

    try {
      const watchParams = new URLSearchParams({ v: data.videoId, ytdl: "1", mute: "1" });
      const watchUrl = `https://www.youtube.com/watch?${watchParams.toString()}`;

      await sendMessage(MessageType.CreateDownloadIframe, {
        videoId: data.videoId,
        watchUrl
      }, originTabId);

      const iframeReadyTimeoutMs = 30_000;
      await new Promise<void>(resolve => {
        const timeoutId = setTimeout(resolve, iframeReadyTimeoutMs);
        const removeListener = onMessage(MessageType.DownloadIframeReady, ({ data: readyData }) => {
          if (readyData.videoId !== data.videoId) {
            return;
          }

          clearTimeout(timeoutId);
          removeListener();
          resolve();
        });
      });

      await sendMessage(MessageType.ExecuteDownloadItem, data, originTabId);

      trackVideoForTab(data.videoId, originTabId);

      await sendMessage(MessageType.StartKeepalive, { videoId: data.videoId }, originTabId);
    } catch (error) {
      console.error("[ytdl:bg] DownloadViaWatchPage failed:", data.videoId, error);
      void sendMessage(MessageType.RemoveDownloadIframe, { videoId: data.videoId }, originTabId);
      void sendMessage(MessageType.UpdateDownloadProgress, {
        videoId: data.videoId, progress: 0, progressType: ProgressType.Video, isRemoved: true
      }, originTabId);
    }
  });

  onMessage(MessageType.Keepalive, () => {});

  onMessage(MessageType.RequestPlaylistDownload, ({ data, sender }) => {
    const tabId = sender.tab?.id;
    if (!tabId) {
      return;
    }

    if (data.isSequential) {
      void dispatchSequentially(data.items, tabId);
    } else {
      void Promise.allSettled(
        data.items.map(item =>
          sendMessage(MessageType.ExecuteDownloadItem, item, tabId))
      );
    }
  });

  onMessage(MessageType.CancelDownload, ({ data }) => {
    for (const videoId of data.videoIds) {
      cancelBackgroundDownload(videoId);
    }

    void cancelDownloads(data.videoIds);
  });

  onMessage(MessageType.StartBackgroundDownload, async ({ data, sender }) => {
    const tabId = sender.tab?.id ?? -1;
    trackVideoForTab(data.videoId, tabId);
    void startBackgroundDownload(data, tabId);
    await sendMessage(MessageType.StartKeepalive, { videoId: data.videoId }, tabId);
  });
}
