import { broadcastDebugLogToYouTubeTabs } from "@/lib/messaging/debug-log";

let processorTabId: number | null = null;

export function setFirefoxInjectorProcessorTabId(tabId: number | null) {
  processorTabId = tabId;
}

// Named function so func.toString() yields `function probeMainWorld(){...}`, which
// Firefox can eval as `(function probeMainWorld(){...})()`. Method shorthand `func(){}` is
// a SyntaxError as a standalone expression.
function probeMainWorld() {
  let postMessageOk = false;
  let postMessageErr = "";
  const isCrossFrame = parent !== self;
  if (isCrossFrame) {
    try {
      parent.postMessage({
        type: "ytdl:scrub-debug",
        msg: `[ytdl:probe] ok href=${location.href.slice(0, 60)}`
      }, "*");
      postMessageOk = true;
    } catch (err) {
      postMessageErr = String(err);
    }
  }

  return {
    isCrossFrame,
    href: location.href.slice(0, 60),
    postMessageOk,
    postMessageErr
  };
}

async function injectScrubScripts(tabId: number, frameId: number) {
  try {
    const probeResults = await browser.scripting.executeScript({
      target: {
        tabId,
        frameIds: [frameId]
      },
      world: browser.scripting.ExecutionWorld.MAIN,
      func: probeMainWorld
    });
    const probeEntry = probeResults[0];
    const probeResult = probeEntry?.result;
    const probeError = probeEntry && "error" in probeEntry ? probeEntry.error : undefined;
    void broadcastDebugLogToYouTubeTabs(`[ytdl:injector] probe frameId=${frameId} result=${JSON.stringify(probeResult)} error=${JSON.stringify(probeError)}`);

    await Promise.all([
      browser.scripting.executeScript({
        target: {
          tabId,
          frameIds: [frameId]
        },
        world: browser.scripting.ExecutionWorld.MAIN,
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
        files: ["/content-scripts/youtube-main.js"]
      })
    ]);
    void broadcastDebugLogToYouTubeTabs(`[ytdl:injector] injected tabId=${tabId} frameId=${frameId}`);
  } catch (error) {
    void broadcastDebugLogToYouTubeTabs(`[ytdl:injector] inject failed tabId=${tabId} frameId=${frameId}: ${String(error)}`);
  }
}

function initFirefoxIframeInjector() {
  // Use onDOMContentLoaded: onCommitted fires before the frame transitions from
  // about:blank to the actual YouTube document, so scripts injected there run in
  // about:blank and see no ytdlScrubMode=1 query parameter.
  // No URL filter here because YouTube's SPA rewrites query params before DOMContentLoaded,
  // stripping ytdlScrubMode=1 — use tabId === processorTabId as the sole guard.
  browser.webNavigation.onDOMContentLoaded.addListener(({ tabId, frameId, url }) => {
    if (frameId === 0) {
      return;
    }

    if (tabId !== processorTabId) {
      return;
    }

    void broadcastDebugLogToYouTubeTabs(`[ytdl:injector] DOMContentLoaded tabId=${tabId} frameId=${frameId} url=${url.slice(0, 80)}`);
    void injectScrubScripts(tabId, frameId);
  });
}
