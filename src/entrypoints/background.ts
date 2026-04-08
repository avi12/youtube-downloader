import { MessageType, onMessage, sendMessage } from "../lib/messaging";
import {
  clearCapturedSabrData,
  getCapturedSabrData,
  extractPoTokenFromBody,
  onSabrBodyCaptured,
  startSabrRequestCapture
} from "../lib/sabr-request-capture";
import { clearLocalStorage, interruptedDownloadsItem, isFFmpegReadyItem, statusProgressItem } from "../lib/storage";
import { ProgressType } from "../types";

export default defineBackground(() => {
  // Content scripts are declared statically via defineContentScript in each
  // entrypoint file. WXT generates the manifest content_scripts entries.

  startSabrRequestCapture();
  onSabrBodyCaptured(tabId => {
    void sendMessage(MessageType.SabrBodyReady, {}, tabId);
  });

  // - Tab tracking -

  const videoIdToTabIds: Record<string, number[]> = {};
  const tabTracker: Record<number, { videoIdsAvailable: string[] }> = {};

  function trackVideoForTab(videoId: string, tabId: number) {
    if (!videoIdToTabIds[videoId]) {
      videoIdToTabIds[videoId] = [tabId];
    } else if (!videoIdToTabIds[videoId].includes(tabId)) {
      videoIdToTabIds[videoId].push(tabId);
    }
  }

  function untrackVideoForTab(videoId: string, tabId: number) {
    if (!videoIdToTabIds[videoId]) {
      return;
    }

    videoIdToTabIds[videoId] = videoIdToTabIds[videoId].filter(id => {
      return id !== tabId;
    });
  }

  // - FFmpeg processor management -
  // Chrome: offscreen document (persistent, not killed by SW lifecycle)
  // Firefox: background tab with offscreen.html (no offscreen API available)

  let processorReady: Promise<void> | null = null;
  let firefoxProcessorTabId: number | null = null;

  function ensureProcessor() {
    if (processorReady) {
      return processorReady;
    }

    processorReady = import.meta.env.FIREFOX
      ? ensureFirefoxProcessorTab()
      : ensureChromeOffscreenDocument();

    return processorReady;
  }

  async function ensureChromeOffscreenDocument() {
    let existingContexts: Browser.runtime.ExtensionContext[] = [];
    try {
      const contextTypes = [browser.runtime.ContextType.OFFSCREEN_DOCUMENT];
      existingContexts = await browser.runtime.getContexts({ contextTypes });
    } catch {
      // getContexts not available in all environments
    }

    if (existingContexts.length > 0) {
      return;
    }

    await browser.offscreen.createDocument({
      url: "/offscreen.html",
      reasons: [browser.offscreen.Reason.WORKERS],
      justification: "FFmpeg WASM processing requires a Worker context"
    });
  }

  async function ensureFirefoxProcessorTab() {
    if (firefoxProcessorTabId !== null) {
      try {
        await browser.tabs.get(firefoxProcessorTabId);
        return;
      } catch {
        firefoxProcessorTabId = null;
      }
    }

    const tab = await browser.tabs.create({
      url: browser.runtime.getURL("/offscreen.html"),
      active: false
    });

    firefoxProcessorTabId = tab.id ?? null;
  }

  void ensureProcessor();

  // - Chunk forwarding to processor -

  onMessage(MessageType.StreamChunk, async ({ data, sender }) => {
    const tabId = sender.tab?.id;
    if (!tabId) {
      return;
    }

    await ensureProcessor();
    await sendMessage(MessageType.ProcessStreamChunk, { ...data, tabId });
  });

  onMessage(MessageType.StreamEnd, async ({ data, sender }) => {
    const tabId = sender.tab?.id;
    if (!tabId) {
      return;
    }

    trackVideoForTab(data.videoId, tabId);
    tabTracker[tabId] ??= { videoIdsAvailable: [] };

    if (!tabTracker[tabId].videoIdsAvailable.includes(data.videoId)) {
      tabTracker[tabId].videoIdsAvailable.push(data.videoId);
    }

    await ensureProcessor();
    await sendMessage(MessageType.ProcessStreamEnd, { ...data, tabId });
  });

  async function cancelDownloads(videoIds: string[]) {
    await sendMessage(MessageType.CancelProcessing, { videoIds });
  }

  // - Message handlers -

  onMessage(MessageType.GetCapturedSabrBody, async ({ sender }) => {
    const tabId = sender.tab?.id;
    if (!tabId) {
      return null;
    }

    const captured = getCapturedSabrData(tabId);
    if (!captured) {
      return null;
    }

    const poToken = extractPoTokenFromBody(captured.body) ?? "";

    return {
      body: btoa(String.fromCharCode(...captured.body)),
      url: captured.url,
      poToken
    };
  });

  onMessage(MessageType.PersistInterruptedDownload, async ({ data }) => {
    const current = await interruptedDownloadsItem.getValue();
    current[data.videoId] = data;
    await interruptedDownloadsItem.setValue(current);
  });

  onMessage(MessageType.ClearInterruptedDownload, async ({ data }) => {
    const current = await interruptedDownloadsItem.getValue();
    delete current[data.videoId];
    await interruptedDownloadsItem.setValue(current);
  });

  onMessage(MessageType.GetInterruptedDownload, async ({ data }) => {
    const current = await interruptedDownloadsItem.getValue();
    return current[data.videoId] ?? null;
  });

  onMessage(MessageType.ProcessStreamError, async ({ data, sender }) => {
    const tabId = sender.tab?.id;
    if (!tabId) {
      return;
    }

    console.error("[ytdl] Stream error for", data.videoId, data.error);
    await sendMessage(
      MessageType.UpdateDownloadProgress,
      {
        videoId: data.videoId,
        progress: 0,
        progressType: ProgressType.Video,
        isRemoved: true
      },
      tabId
    );
  });

  // Download via hidden iframe. Content scripts auto-inject into the iframe
  // via allFrames: true (with isDownloadIframe guard to skip non-download iframes).
  // visibility-spoof.content.ts ensures YouTube's player streams in hidden iframes.
  onMessage(MessageType.DownloadViaWatchPage, async ({ data, sender }) => {
    const originTabId = sender.tab?.id;
    if (!originTabId) {
      return;
    }

    const watchUrl = `https://www.youtube.com/watch?v=${data.videoId}&ytdl=1&autoplay=0`;

    await sendMessage(MessageType.CreateDownloadIframe, {
      videoId: data.videoId,
      watchUrl
    }, originTabId);

    // Wait for iframe load + content scripts to initialize
    await new Promise<void>(resolve => {
      const removeListener = onMessage(MessageType.DownloadIframeReady, ({ data: readyData }) => {
        if (readyData.videoId === data.videoId) {
          removeListener();
          resolve();
        }
      });

      setTimeout(() => {
        removeListener();
        resolve();
      }, 30_000);
    });

    // Give YouTube player and content scripts time to initialize
    await new Promise(resolve => {
      return setTimeout(resolve, 8000);
    });

    // Send download request - only the iframe's content script handles it
    // (isWatchPage guard filters out the subscriptions page)
    try {
      await sendMessage(MessageType.ExecuteDownloadItem, data, originTabId);
    } catch {
      await new Promise(resolve => {
        return setTimeout(resolve, 3000);
      });
      await sendMessage(MessageType.ExecuteDownloadItem, data, originTabId);
    }

    trackVideoForTab(data.videoId, originTabId);
    tabTracker[originTabId] ??= { videoIdsAvailable: [] };
    tabTracker[originTabId].videoIdsAvailable.push(data.videoId);

    void sendMessage(MessageType.StartKeepalive, { videoId: data.videoId }, originTabId);
  });

  // Keepalive ping from content scripts - resets SW idle timer
  onMessage(MessageType.Keepalive, () => {});

  onMessage(MessageType.RequestPlaylistDownload, async ({ data, sender }) => {
    const tabId = sender.tab?.id;
    if (!tabId) {
      return;
    }

    await Promise.all(data.items.map(item => {
      return sendMessage(MessageType.ExecuteDownloadItem, item, tabId);
    }
    ));
  });

  onMessage(MessageType.CancelDownload, ({ data }) => {
    void cancelDownloads(data.videoIds);
  });

  // - Pipeline storage handlers (chrome.storage unavailable in offscreen) -

  onMessage(MessageType.PipelineProgress, async ({ data }) => {
    const { videoId, progress, progressType, tabId } = data;
    const current = await statusProgressItem.getValue();
    current[videoId] = { progress, progressType };

    await Promise.allSettled([
      sendMessage(MessageType.UpdateDownloadProgress, {
        videoId,
        progress,
        progressType
      }, tabId),
      statusProgressItem.setValue(current)
    ]);
  });

  onMessage(MessageType.PipelineRemoval, async ({ data }) => {
    const { videoId, tabId } = data;
    const current = await statusProgressItem.getValue();
    delete current[videoId];

    await Promise.allSettled([
      sendMessage(
        MessageType.UpdateDownloadProgress,
        {
          videoId,
          progress: 0,
          progressType: ProgressType.Video,
          isRemoved: true
        },
        tabId
      ),
      statusProgressItem.setValue(current)
    ]);
  });

  onMessage(MessageType.PipelineQueueRemove, async ({ data }) => {
    const { videoId } = data;
    const current = await statusProgressItem.getValue();
    delete current[videoId];
    await statusProgressItem.setValue(current);
  });

  onMessage(MessageType.PipelineFFmpegReady, async () => {
    await isFFmpegReadyItem.setValue(true);
  });

  onMessage(MessageType.PipelineDownload, async ({ data }) => {
    await browser.downloads.download({
      url: data.blobUrl,
      filename: data.filename
    });
  });

  // - Tab lifecycle -

  browser.tabs.onRemoved.addListener(async tabId => {
    if (tabId === firefoxProcessorTabId) {
      firefoxProcessorTabId = null;
      processorReady = null;
      return;
    }

    const tracked = tabTracker[tabId];
    if (!tracked) {
      return;
    }

    delete tabTracker[tabId];
    clearCapturedSabrData(tabId);

    for (const videoId of tracked.videoIdsAvailable) {
      untrackVideoForTab(videoId, tabId);
    }

    await cancelDownloads(tracked.videoIdsAvailable);
  });

  browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.status !== "loading" || !tab.url?.includes("youtube.com")) {
      return;
    }

    const tracked = tabTracker[tabId];
    if (!tracked) {
      return;
    }

    for (const videoId of tracked.videoIdsAvailable) {
      untrackVideoForTab(videoId, tabId);
    }

    clearCapturedSabrData(tabId);
    await cancelDownloads(tracked.videoIdsAvailable);
    tabTracker[tabId] = { videoIdsAvailable: [] };
  });

  // - Initialization -

  browser.runtime.onInstalled.addListener(async ({ reason }) => {
    // Only clear storage on fresh install, not on reload/update
    if (reason === browser.runtime.OnInstalledReason.INSTALL) {
      await clearLocalStorage();
    }
  });
});
