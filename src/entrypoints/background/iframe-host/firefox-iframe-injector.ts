import { broadcastDebugLogToYouTubeTabs } from "@/lib/messaging/debug-log";

let processorTabId: number | null = null;

export function setFirefoxInjectorProcessorTabId(tabId: number | null) {
  processorTabId = tabId;
}

const SCRUB_URL_FILTER = { url: [{ queryContains: "ytdlScrubMode=1" }] };

async function injectScrubScripts(tabId: number, frameId: number) {
  try {
    await Promise.all([
      browser.scripting.executeScript({
        target: {
          tabId,
          frameIds: [frameId]
        },
        world: browser.scripting.ExecutionWorld.MAIN,
        injectImmediately: true,
        files: [
          "/content-scripts/sourcebuffer-capture.js",
          "/content-scripts/sabr-fetch-interceptor.js"
        ]
      }),
      browser.scripting.executeScript({
        target: {
          tabId,
          frameIds: [frameId]
        },
        world: browser.scripting.ExecutionWorld.MAIN,
        injectImmediately: true,
        files: ["/content-scripts/youtube-main.js"]
      })
    ]);
    void broadcastDebugLogToYouTubeTabs(`[ytdl:injector] injected tabId=${tabId} frameId=${frameId}`);
  } catch (error) {
    void broadcastDebugLogToYouTubeTabs(`[ytdl:injector] inject failed tabId=${tabId} frameId=${frameId}: ${String(error)}`);
  }
}

export function initFirefoxIframeInjector() {
  browser.webNavigation.onCommitted.addListener(({ tabId, frameId, url }) => {
    if (frameId === 0) {
      return;
    }

    if (tabId !== processorTabId) {
      return;
    }

    void broadcastDebugLogToYouTubeTabs(`[ytdl:injector] webNav committed tabId=${tabId} frameId=${frameId} url=${url.slice(0, 80)}`);
    void injectScrubScripts(tabId, frameId);
  }, SCRUB_URL_FILTER);
}
