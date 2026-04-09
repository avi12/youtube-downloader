import { awaitVideoComplete } from "./sequential-queue";
import { cancelDownloads, trackVideoForTab } from "./tab-tracker";
import { MessageType, onMessage, sendMessage } from "@/lib/messaging";
import type { DownloadRequest } from "@/types";

const bufferChunkSize = 8192;

async function dispatchSequentially(items: DownloadRequest[], tabId: number) {
  for (const item of items) {
    await sendMessage(MessageType.ExecuteDownloadItem, item, tabId);
    await awaitVideoComplete(item.videoId);
  }
}

export function registerDownloadHandlers() {
  // Proxy SABR fetch requests through the background SW, which has host_permissions
  // for googlevideo.com and bypasses CORS without preflight. credentials: 'include'
  // lets the browser attach any existing googlevideo.com cookies automatically.
  // SABR authentication uses a Bearer PO token, not YouTube session cookies.
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

  // Download via hidden iframe. Content scripts auto-inject into the iframe
  // via allFrames: true (with isDownloadIframe guard to skip non-download iframes).
  // visibility-spoof.content.ts ensures YouTube's player streams in hidden iframes.
  onMessage(MessageType.DownloadViaWatchPage, async ({ data, sender }) => {
    const originTabId = sender.tab?.id;
    if (!originTabId) {
      return;
    }

    const watchParams = new URLSearchParams({ v: data.videoId, ytdl: "1", mute: "1" });
    const watchUrl = `https://www.youtube.com/watch?${watchParams.toString()}`;

    await sendMessage(MessageType.CreateDownloadIframe, {
      videoId: data.videoId,
      watchUrl
    }, originTabId);

    // Wait for the iframe's MAIN world content script to signal player initialization.
    // IframePlayerReady is sent after capture state is set up, bridged to background
    // as DownloadIframeReady by the isolated world. Timeout prevents hanging forever.
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

    // Send download request - only the iframe's content script handles it
    // (isWatchPage guard filters out the subscriptions page)
    await sendMessage(MessageType.ExecuteDownloadItem, data, originTabId);

    trackVideoForTab(data.videoId, originTabId);

    await sendMessage(MessageType.StartKeepalive, { videoId: data.videoId }, originTabId);
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
      void Promise.allSettled(data.items.map(item =>
        sendMessage(MessageType.ExecuteDownloadItem, item, tabId)));
    }
  });

  onMessage(MessageType.CancelDownload, ({ data }) => {
    void cancelDownloads(data.videoIds);
  });
}
