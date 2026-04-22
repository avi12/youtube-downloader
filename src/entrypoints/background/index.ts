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
const YT_SAPISID_ORIGIN = "https://www.youtube.com";

async function sha1Hex(input: string) {
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

async function buildSapisidHashHeader(cookies: Browser.cookies.Cookie[]) {
  const sapisid = cookies.find(c => c.name === "SAPISID")?.value;
  const sapisid1p = cookies.find(c => c.name === "__Secure-1PAPISID")?.value;
  const sapisid3p = cookies.find(c => c.name === "__Secure-3PAPISID")?.value;
  if (!sapisid && !sapisid1p && !sapisid3p) {
    return null;
  }

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const parts: string[] = [];
  if (sapisid) {
    const hash = await sha1Hex(`${timestamp} ${sapisid} ${YT_SAPISID_ORIGIN}`);
    parts.push(`SAPISIDHASH ${timestamp}_${hash}`);
  }

  if (sapisid1p) {
    const hash = await sha1Hex(`${timestamp} ${sapisid1p} ${YT_SAPISID_ORIGIN}`);
    parts.push(`SAPISID1PHASH ${timestamp}_${hash}`);
  }

  if (sapisid3p) {
    const hash = await sha1Hex(`${timestamp} ${sapisid3p} ${YT_SAPISID_ORIGIN}`);
    parts.push(`SAPISID3PHASH ${timestamp}_${hash}`);
  }

  return parts.join(" ");
}

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

  // Firefox: log the Cookie header our SW fetch is about to send vs what
  // youtube.com's real cookies are. Hypothesis: Firefox's cookie
  // partitioning gives the background SW a different (or empty) cookie jar
  // than the youtube.com page, so the PO token YT minted for the page's
  // session doesn't match what the server sees for our SW fetch.
  // Firefox doesn't automatically attach youtube.com cookies to extension
  // background-SW cross-origin fetches even with `credentials: "include"` and
  // `host_permissions` for googlevideo.com. Without a session cookie, YT
  // can't match the PO token to any session and emits
  // `streamProtectionStatus=3` (attestation required) on the UMP stream.
  // Inject the YouTube cookies manually on googlevideo videoplayback
  // requests originated by our SW (tabId === -1).
  // Firefox accepts async webRequest listeners (returning a Promise<BlockingResponse>);
  // the webextension-polyfill types don't model it, so cast the listener shape.
  if (import.meta.env.FIREFOX) {
    type AsyncBlockingListener = (
      details: Browser.webRequest.OnBeforeSendHeadersDetails
    ) => Promise<Browser.webRequest.BlockingResponse | undefined>;

    const onBeforeSendHeaders = browser.webRequest.onBeforeSendHeaders as typeof browser.webRequest.onBeforeSendHeaders & {
      addListener(
        callback: AsyncBlockingListener,
        filter: Browser.webRequest.RequestFilter,
        extraInfoSpec: string[]
      ): void;
    };

    onBeforeSendHeaders.addListener(
      async details => {
        if (details.tabId >= 0) {
          return undefined;
        }

        const cookies = await browser.cookies.getAll({ url: "https://www.youtube.com/" });
        if (cookies.length === 0) {
          return undefined;
        }

        const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join("; ");
        const headers = (details.requestHeaders ?? []).filter(h => {
          const name = h.name.toLowerCase();
          return name !== "cookie" && name !== "authorization";
        });
        headers.push({ name: "Cookie", value: cookieHeader });

        // YouTube authenticates API/SABR requests with an Authorization header
        // derived from the (1P|3P)APISID cookies. The page's JS computes it;
        // our SW doesn't, so YT sees an authenticated-looking Cookie jar but
        // no matching Authorization and treats the request as needing fresh
        // attestation. Compute it the same way the player does.
        const authHeader = await buildSapisidHashHeader(cookies);
        if (authHeader) {
          headers.push({ name: "Authorization", value: authHeader });
          headers.push({ name: "X-Origin", value: "https://www.youtube.com" });
          headers.push({ name: "X-Goog-AuthUser", value: "0" });
        }

        return { requestHeaders: headers };
      },
      { urls: ["https://*.googlevideo.com/videoplayback*"] },
      ["blocking", "requestHeaders"]
    );
  }

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
