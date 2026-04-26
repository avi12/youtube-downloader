import { registerPoTokenRefreshListener } from "./download/sabr-downloader";
import { registerDownloadHandlers } from "./handlers/download-handlers";
import { registerIframeScrubOrchestrator } from "./handlers/iframe-scrub-orchestrator";
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
const INNERTUBE_ORIGIN_RULE_ID = 2;
const YOUTUBE_FRAME_OPTIONS_RULE_ID = 3;

// Spoof a recent Chrome on Windows. Firefox extensions making BG SW googlevideo
// POSTs hit YouTube's attestation_required wall on long videos; the lib body is
// identical between browsers, so the most likely flagging signal is User-Agent
// (TLS fingerprint differs too but isn't reachable from the extension layer).
const CHROME_USER_AGENT_SPOOF =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36";

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

  // On Firefox, also spoof User-Agent to look like Chrome so YouTube's
  // attestation_required check (which appears to flag Firefox UA on long
  // videos) treats us like Chrome — the lib's request body is identical
  // between browsers anyway.
  const firefoxOnlyHeaders: Browser.declarativeNetRequest.ModifyHeaderInfo[] = import.meta.env.FIREFOX
    ? [
      {
        header: "User-Agent",
        operation: "set",
        value: CHROME_USER_AGENT_SPOOF
      }
    ]
    : [];

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

  const sabrRule: Browser.declarativeNetRequest.Rule = {
    id: SABR_ORIGIN_RULE_ID,
    priority: 1,
    action: {
      type: "modifyHeaders",
      requestHeaders: [...baseHeaders, ...chromeOnlyHeaders, ...firefoxOnlyHeaders]
    },
    // tabIds: [-1] scopes the rule to extension-initiated requests only, so we
    // don't overwrite the user's tab player's own outgoing UA.
    condition: {
      urlFilter: "||googlevideo.com/videoplayback",
      tabIds: [-1]
    }
  };

  // When the extension calls youtubei/v1/player from the background, Firefox
  // sends Origin: moz-extension://..., which the innertube endpoint 403s. Rewrite
  // to youtube.com so the alternate-client fallback is accepted.
  const innertubeRule: Browser.declarativeNetRequest.Rule = {
    id: INNERTUBE_ORIGIN_RULE_ID,
    priority: 1,
    action: {
      type: "modifyHeaders",
      requestHeaders: baseHeaders
    },
    condition: { urlFilter: "||youtube.com/youtubei/" }
  };

  // YouTube serves /watch with X-Frame-Options: SAMEORIGIN and
  // Content-Security-Policy: frame-ancestors, which Firefox enforces by
  // refusing to render the iframe (contentWindow becomes a dead object). Our
  // BG-hosted factory iframes are on moz-extension://, not youtube.com, so
  // they're blocked. Strip both response headers for documents loaded into
  // factory iframes. Tagged via the ytdlTrustFactoryMode URL param.
  const youtubeFrameOptionsRule: Browser.declarativeNetRequest.Rule = {
    id: YOUTUBE_FRAME_OPTIONS_RULE_ID,
    priority: 1,
    action: {
      type: "modifyHeaders",
      responseHeaders: [
        {
          header: "x-frame-options",
          operation: "remove"
        },
        {
          header: "content-security-policy",
          operation: "remove"
        }
      ]
    },
    condition: {
      regexFilter: "^https://www\\.youtube\\.com/.*ytdlTrustFactoryMode=1",
      resourceTypes: ["sub_frame"]
    }
  };

  await browser.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [SABR_ORIGIN_RULE_ID, INNERTUBE_ORIGIN_RULE_ID, YOUTUBE_FRAME_OPTIONS_RULE_ID],
    addRules: [sabrRule, innertubeRule, youtubeFrameOptionsRule]
  });
}

function rewriteSabrHeaders(details: Browser.webRequest.OnBeforeSendHeadersDetails) {
  const requestHeaders = (details.requestHeaders ?? []).filter(header => {
    const name = header.name.toLowerCase();
    return name !== "origin" && name !== "referer";
  });
  requestHeaders.push(
    { name: "Origin", value: "https://www.youtube.com" },
    { name: "Referer", value: "https://www.youtube.com/" }
  );
  return { requestHeaders };
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
  registerIframeScrubOrchestrator();
  registerPipelineHandlers();
  registerPoTokenRefreshListener();
  registerRecentDownloadsRetention();
  registerStorageHandlers();
  registerTabLifecycleHandlers();

  browser.runtime.onInstalled.addListener(({ reason }) => {
    if (reason === browser.runtime.OnInstalledReason.INSTALL) {
      void clearLocalStorage();
    }
  });
});
