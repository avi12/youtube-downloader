import { isOffscreenConnected } from "@/lib/messaging/offscreen-messaging";

let processorReady: Promise<void> | null = null;
let resolveFFmpegReady: (() => void) | null = null;

const OFFSCREEN_URL_PATH = "/offscreen.html";
const OFFSCREEN_IFRAME_ID = "ytdl-offscreen-iframe";

export function signalFFmpegReady() {
  resolveFFmpegReady?.();
  resolveFFmpegReady = null;
}

async function waitForFFmpegReady() {
  return new Promise<void>(resolve => resolveFFmpegReady = resolve);
}

function isOffscreenApiAvailable() {
  return typeof browser.offscreen !== "undefined";
}

// Chrome MV3: spawn a real offscreen document via the offscreen API. The
// service worker cannot host FFmpeg WASM or download iframes itself, so the
// offscreen document acts as a persistent Document context for both.
async function ensureChromeOffscreenDocument() {
  let existingContexts: Browser.runtime.ExtensionContext[] = [];
  try {
    const contextTypes = [browser.runtime.ContextType.OFFSCREEN_DOCUMENT];
    existingContexts = await browser.runtime.getContexts({ contextTypes });
  } catch { /* getContexts not always available */ }

  if (existingContexts.length > 0) {
    try {
      await browser.offscreen.closeDocument();
    } catch { /* already closed */ }
  }

  await browser.offscreen.createDocument({
    url: OFFSCREEN_URL_PATH,
    reasons: [browser.offscreen.Reason.WORKERS, browser.offscreen.Reason.IFRAME_SCRIPTING],
    justification: "FFmpeg WASM mux + hidden YouTube watch iframe for grid-page downloads"
  });
}

// Firefox MV3: no offscreen API. The background event-page IS a Document
// context, so we host offscreen.html in a hidden iframe inside it. The rest
// of the pipeline (FFmpeg muxer, download-worker iframes) is identical to
// Chrome's because both browsers end up with offscreen.html in a Document.
function ensureFirefoxOffscreenIframe() {
  const elExisting = document.getElementById(OFFSCREEN_IFRAME_ID);
  if (elExisting) {
    elExisting.remove();
  }

  const elIframe = document.createElement("iframe");
  elIframe.id = OFFSCREEN_IFRAME_ID;
  elIframe.src = browser.runtime.getURL(OFFSCREEN_URL_PATH);
  elIframe.style.cssText = "display:none";
  document.body.append(elIframe);
}

async function ensureOffscreenDocument() {
  const ffmpegReady = waitForFFmpegReady();
  if (isOffscreenApiAvailable()) {
    await ensureChromeOffscreenDocument();
  } else {
    ensureFirefoxOffscreenIframe();
  }

  await ffmpegReady;
}

export async function ensureProcessor() {
  const isAlive = processorReady && isOffscreenConnected();
  if (isAlive) {
    return processorReady;
  }

  processorReady = ensureOffscreenDocument();
  return processorReady;
}
