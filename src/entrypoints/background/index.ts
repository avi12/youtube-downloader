import { registerDownloadHandlers } from "./handlers/download-handlers";
import { registerPipelineHandlers } from "./handlers/pipeline-handlers";
import { ensureProcessor } from "./handlers/processor";
import { getTabIdsForVideo, tabTracker, trackVideoForTab, untrackVideoForTab } from "./queue/tab-tracker";
import { registerRecentDownloadsRetention } from "./recent/recent-downloads-retention";
import { MessageType, onMessage, sendMessage } from "@/lib/messaging/messaging";
import { OffscreenMessageType, sendToOffscreen } from "@/lib/messaging/offscreen-messaging";
import {
  clearLocalStorage,
  interruptedDownloadsItem,
  mutateStorageItem,
  musicListItem,
  statusProgressItem,
  videoDetailsItem,
  videoOnlyListItem,
  videoQueueItem
} from "@/lib/storage/storage";
import { uint8ToBase64 } from "@/lib/utils/binary";
import { clearCapturedSabrData, onSabrBodyCaptured, startSabrRequestCapture } from "@/lib/youtube/sabr-request-capture";
import { extractPoTokenFromBody, getCapturedSabrData } from "@/lib/youtube/sabr-request-capture";

const SABR_ORIGIN_RULE_ID = 1;

async function registerSabrOriginRule() {
  const baseHeaders: Browser.declarativeNetRequest.ModifyHeaderInfo[] = [
    {
      header: "Origin",
      operation: "set",
      value: "https://www.youtube.com"
    },
    {
      header: "Referer",
      operation: "set",
      value: "https://www.youtube.com/"
    }
  ];

  // Sec-Fetch-* headers are browser-managed in Firefox; overriding them aborts requests
  const chromeOnlyHeaders: Browser.declarativeNetRequest.ModifyHeaderInfo[] = import.meta.env.FIREFOX
    ? []
    : [
      {
        header: "Sec-Fetch-Site",
        operation: "set",
        value: "cross-site"
      },
      {
        header: "Sec-Fetch-Storage-Access",
        operation: "set",
        value: "active"
      }
    ];

  const rule: Browser.declarativeNetRequest.Rule = {
    id: SABR_ORIGIN_RULE_ID,
    priority: 1,
    action: {
      type: "modifyHeaders",
      requestHeaders: [...baseHeaders, ...chromeOnlyHeaders]
    },
    condition: {
      urlFilter: "||googlevideo.com/videoplayback",
      resourceTypes: ["xmlhttprequest", "sub_frame", "main_frame", "media", "other"]
    }
  };
  await browser.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [SABR_ORIGIN_RULE_ID],
    addRules: [rule]
  });
}

function registerChunkHandlers() {
  onMessage(MessageType.StreamChunk, async ({ data, sender }) => {
    const tabId = sender.tab?.id ?? getTabIdsForVideo(data.videoId)[0];
    if (!tabId) {
      return;
    }

    await ensureProcessor();
    sendToOffscreen(OffscreenMessageType.ProcessStreamChunk, {
      ...data,
      tabId
    });
  });

  onMessage(MessageType.StreamEnd, async ({ data, sender }) => {
    const tabId = sender.tab?.id ?? getTabIdsForVideo(data.videoId)[0];
    if (!tabId) {
      return;
    }

    trackVideoForTab({
      videoId: data.videoId,
      tabId
    });
    await ensureProcessor();
    sendToOffscreen(OffscreenMessageType.ProcessStreamEnd, {
      ...data,
      tabId
    });
  });
}

function registerStorageHandlers() {
  onMessage(MessageType.GetCapturedSabrBody, ({ sender }) => {
    const tabId = sender.tab?.id;
    if (typeof tabId !== "number") {
      return null;
    }

    const captured = getCapturedSabrData(tabId);
    if (!captured) {
      return null;
    }

    return {
      body: uint8ToBase64(new Uint8Array(captured.body)),
      url: captured.url,
      poToken: extractPoTokenFromBody(captured.body) ?? ""
    };
  });

  onMessage(MessageType.PersistInterruptedDownload, async ({ data }) => {
    await mutateStorageItem(interruptedDownloadsItem, current => {
      current[data.videoId] = data;
    });
  });

  onMessage(MessageType.ClearInterruptedDownload, async ({ data }) => {
    await mutateStorageItem(interruptedDownloadsItem, current => {
      delete current[data.videoId];
    });
  });

  onMessage(MessageType.GetInterruptedDownload, async ({ data }) => {
    const current = await interruptedDownloadsItem.getValue();
    return current[data.videoId] ?? null;
  });
}

function registerTabLifecycleHandlers() {
  browser.tabs.onRemoved.addListener(tabId => {
    const tabState = tabTracker[tabId];
    if (!tabState) {
      return;
    }

    delete tabTracker[tabId];
    clearCapturedSabrData(tabId);

    for (const videoId of tabState.videoIdsAvailable) {
      untrackVideoForTab({
        videoId,
        tabId
      });
    }
  });

  browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status !== browser.tabs.TabStatus.LOADING || !(tab.url ?? "").includes("youtube.com")) {
      return;
    }

    const tabState = tabTracker[tabId];
    if (!tabState) {
      return;
    }

    for (const videoId of tabState.videoIdsAvailable) {
      untrackVideoForTab({
        videoId,
        tabId
      });
    }

    clearCapturedSabrData(tabId);
    tabTracker[tabId] = { videoIdsAvailable: [] };
  });
}

export default defineBackground(async () => {
  void registerSabrOriginRule();
  startSabrRequestCapture();
  onSabrBodyCaptured(tabId => {
    void sendMessage(MessageType.SabrBodyReady, {}, tabId);
  });

  void statusProgressItem.setValue({});
  void videoQueueItem.setValue([]);
  void musicListItem.setValue([]);
  void videoOnlyListItem.setValue([]);
  void videoDetailsItem.setValue({});

  if (import.meta.env.FIREFOX) {
    const processorUrl = browser.runtime.getURL("/offscreen.html");
    const tabs = await browser.tabs.query({ url: processorUrl });
    await Promise.all(tabs.map(tab => tab.id !== undefined ? browser.tabs.remove(tab.id) : Promise.resolve()));
  }

  void ensureProcessor();

  browser.runtime.onMessage.addListener((message: {
    type?: string;
    dataUrl?: string;
    filename?: string;
  }) => {
    if (message.type !== OffscreenMessageType.PipelineDownload || !message.dataUrl || !message.filename) {
      return;
    }

    void browser.downloads.download({
      url: message.dataUrl,
      filename: message.filename
    });
  });

  registerChunkHandlers();
  registerDownloadHandlers();
  registerPipelineHandlers();
  registerRecentDownloadsRetention();
  registerStorageHandlers();
  registerTabLifecycleHandlers();

  browser.runtime.onInstalled.addListener(({ reason }) => {
    if (reason === browser.runtime.OnInstalledReason.INSTALL) {
      void clearLocalStorage();
    }
  });
});
