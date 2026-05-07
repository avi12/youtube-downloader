import { resolvePrimerCapture } from "./download/primer-capture";
import { registerChunkHandlers, registerStorageHandlers } from "./handlers/chunk-and-storage-handlers";
import { registerDownloadHandlers } from "./handlers/download-handlers";
import { registerPipelineHandlers } from "./handlers/pipeline-handlers";
import { ensureProcessor } from "./handlers/processor";
import { registerTabLifecycleHandlers } from "./handlers/tab-lifecycle";
import { registerSabrOriginRule, registerFactoryIframeHeaderStripper } from "./network/declarative-net-request";
import { registerRecentDownloadsRetention } from "./recent/recent-downloads-retention";
import { broadcastDebugLogToYouTubeTabs } from "@/lib/messaging/debug-log";
import { MessageType, onMessage, sendMessage } from "@/lib/messaging/messaging";
import {
  clearLocalStorage,
  musicListItem,
  statusProgressItem,
  videoDetailsItem,
  videoOnlyListItem,
  videoQueueItem
} from "@/lib/storage/storage";
import { onSabrBodyCaptured, startSabrRequestCapture } from "@/lib/youtube/sabr/request-capture";

const GOOGLEVIDEO_PATTERN = "https://*.googlevideo.com/videoplayback*";
const YT_ORIGIN = "https://www.youtube.com";
const AUTH_REFRESH_INTERVAL_MS = 45_000;
const CHROME_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36";
const IOS_USER_AGENT = "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_1_0 like Mac OS X)";
const TV_USER_AGENT = "Mozilla/5.0 (PlayStation; PlayStation 4/12.00) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/5.0 Safari/605.1.15";

function resolveClientUserAgent(url: string) {
  const clientParam = new URL(url).searchParams.get("c") ?? "";
  if (clientParam === "IOS") {
    return IOS_USER_AGENT;
  }

  if (clientParam.startsWith("TVHTML5")) {
    return TV_USER_AGENT;
  }

  return CHROME_USER_AGENT;
}

let cachedSapiSidHash: string | null = null;
let cachedYtCookieHeader: string | null = null;

async function buildSapiSidHashFromCookies(cookies: Browser.cookies.Cookie[]) {
  const apiSidCookie = cookies.find(cookie => cookie.name === "__Secure-3PAPISID")
    ?? cookies.find(cookie => cookie.name === "__Secure-1PAPISID")
    ?? cookies.find(cookie => cookie.name === "SAPISID");
  if (!apiSidCookie?.value) {
    return null;
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const message = `${timestamp} ${apiSidCookie.value} ${YT_ORIGIN}`;
  const hashBuffer = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(message));
  const hash = Array.from(new Uint8Array(hashBuffer)).map(byte => byte.toString(16).padStart(2, "0")).join("");
  return `SAPISIDHASH ${timestamp}_${hash}`;
}

async function refreshFirefoxAuthCache() {
  const cookies = await browser.cookies.getAll({ url: YT_ORIGIN });
  const authHeader = await buildSapiSidHashFromCookies(cookies);
  cachedSapiSidHash = authHeader;
  cachedYtCookieHeader = cookies.map(cookie => `${cookie.name}=${cookie.value}`).join("; ");
  void broadcastDebugLogToYouTubeTabs(`[ytdl:bg] auth cache: hash=${authHeader ? "ok" : "null"} cookies=${cookies.length}`);
}

let bgStartCount = 0;
export default defineBackground(() => {
  bgStartCount++;
  void broadcastDebugLogToYouTubeTabs(`[ytdl:bg] background started (count=${bgStartCount})`);
  registerSabrOriginRule().catch(error => console.error("[ytdl:bg] registerSabrOriginRule failed:", error));
  registerFactoryIframeHeaderStripper();

  onMessage(MessageType.BgDebugLog, async ({ data }) => {
    const tabs = await browser.tabs.query({ url: "https://www.youtube.com/*" });
    for (const tab of tabs) {
      if (typeof tab.id === "number") {
        void sendMessage(MessageType.BgDebugLog, data, tab.id);
      }
    }
  });

  void startSabrRequestCapture();
  onSabrBodyCaptured(tabId => {
    void sendMessage(MessageType.SabrBodyReady, {}, tabId);
  });

  onMessage(MessageType.SabrTemplateReady, ({ data }) => {
    if (data.factoryId?.startsWith("sabr-primer-")) {
      resolvePrimerCapture(data.factoryId, data.url, data.bodyBase64);
    }
  });

  void statusProgressItem.setValue({});
  void videoQueueItem.setValue([]);
  void musicListItem.setValue([]);
  void videoOnlyListItem.setValue([]);
  void videoDetailsItem.setValue({});

  if (import.meta.env.FIREFOX) {
    void refreshFirefoxAuthCache();
    setInterval(() => void refreshFirefoxAuthCache(), AUTH_REFRESH_INTERVAL_MS);

    browser.webRequest.onBeforeSendHeaders.addListener(
      details => {
        const isSabrPost = details.method === "POST";
        if (isSabrPost) {
          const headersToStrip = new Set(["user-agent", "cookie", "origin", "authorization"]);
          const headers = (details.requestHeaders ?? []).filter(
            header => !headersToStrip.has(header.name.toLowerCase())
          );
          headers.push({
            name: "User-Agent",
            value: resolveClientUserAgent(details.url)
          });

          if (cachedSapiSidHash) {
            headers.push({
              name: "Authorization",
              value: cachedSapiSidHash
            });
            headers.push({
              name: "X-Origin",
              value: YT_ORIGIN
            });
            headers.push({
              name: "X-Goog-AuthUser",
              value: "0"
            });
          }

          headers.push({
            name: "Origin",
            value: YT_ORIGIN
          });

          if (cachedYtCookieHeader) {
            headers.push({
              name: "Cookie",
              value: cachedYtCookieHeader
            });
          }

          return { requestHeaders: headers };
        }

        const resolvedUA = resolveClientUserAgent(details.url);
        const headersToStrip = new Set(["user-agent", "cookie", "origin"]);
        const headers = (details.requestHeaders ?? []).filter(
          header => !headersToStrip.has(header.name.toLowerCase())
        );
        headers.push({
          name: "User-Agent",
          value: resolvedUA
        });
        headers.push({
          name: "Origin",
          value: YT_ORIGIN
        });

        if (cachedYtCookieHeader) {
          headers.push({
            name: "Cookie",
            value: cachedYtCookieHeader
          });
        }

        return { requestHeaders: headers };
      },
      { urls: [GOOGLEVIDEO_PATTERN] },
      ["blocking", "requestHeaders"]
    );

    browser.webRequest.onHeadersReceived.addListener(
      details => {
        const filteredHeaders = (details.responseHeaders ?? []).filter(
          header => !header.name.toLowerCase().startsWith("access-control-")
        );
        return {
          responseHeaders: [
            ...filteredHeaders,
            {
              name: "Access-Control-Allow-Origin",
              value: YT_ORIGIN
            },
            {
              name: "Access-Control-Allow-Credentials",
              value: "true"
            }
          ]
        };
      },
      { urls: [GOOGLEVIDEO_PATTERN] },
      ["blocking", "responseHeaders"]
    );
  }

  void ensureProcessor();

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
