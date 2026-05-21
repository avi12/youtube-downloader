import { isOffscreenConnected } from "@/lib/messaging/offscreen-messaging";

let processorReady: Promise<void> | null = null;
let resolveFFmpegReady: (() => void) | null = null;

export function signalFFmpegReady() {
  resolveFFmpegReady?.();
  resolveFFmpegReady = null;
}

async function waitForFFmpegReady() {
  return new Promise<void>(resolve => resolveFFmpegReady = resolve);
}

async function ensureOffscreenDocument() {
  let existingContexts: Browser.runtime.ExtensionContext[] = [];

  try {
    const contextTypes = [browser.runtime.ContextType.OFFSCREEN_DOCUMENT];
    existingContexts = await browser.runtime.getContexts({ contextTypes });
  } catch { /* not available in Firefox */ }

  const isExistingContextPresent = existingContexts.length > 0;
  if (isExistingContextPresent) {
    try {
      await browser.offscreen.closeDocument();
    } catch { /* already closed */ }
  }

  const ffmpegReady = waitForFFmpegReady();
  await browser.offscreen.createDocument({
    url: "/offscreen.html",
    reasons: [browser.offscreen.Reason.WORKERS, browser.offscreen.Reason.IFRAME_SCRIPTING],
    justification: "FFmpeg WASM mux + hidden YouTube watch iframe for grid-page downloads"
  });

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
