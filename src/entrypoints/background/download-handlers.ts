import { MessageType, onMessage, sendMessage } from "../../lib/messaging";
import { cancelDownloads, tabTracker, trackVideoForTab } from "./tab-tracker";

export function registerDownloadHandlers() {
  // Download via hidden iframe. Content scripts auto-inject into the iframe
  // via allFrames: true (with isDownloadIframe guard to skip non-download iframes).
  // visibility-spoof.content.ts ensures YouTube's player streams in hidden iframes.
  onMessage(MessageType.DownloadViaWatchPage, async ({ data, sender }) => {
    const originTabId = sender.tab?.id;
    if (!originTabId) {
      return;
    }

    const watchUrl = `https://www.youtube.com/watch?v=${data.videoId}&ytdl=1`;

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
    tabTracker[originTabId] ??= { videoIdsAvailable: [] };
    tabTracker[originTabId].videoIdsAvailable.push(data.videoId);

    await sendMessage(MessageType.StartKeepalive, { videoId: data.videoId }, originTabId);
  });

  onMessage(MessageType.Keepalive, () => {});

  onMessage(MessageType.RequestPlaylistDownload, async ({ data, sender }) => {
    const tabId = sender.tab?.id;
    if (!tabId) {
      return;
    }

    await Promise.allSettled(
      data.items.map(item =>
        sendMessage(MessageType.ExecuteDownloadItem, item, tabId)
      )
    );
  });

  onMessage(MessageType.CancelDownload, ({ data }) => {
    void cancelDownloads(data.videoIds);
  });
}
