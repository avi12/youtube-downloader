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
  } catch {
    // getContexts is not available in Firefox
  }

  const hasExistingContext = existingContexts.length > 0;
  if (hasExistingContext) {
    try {
      await browser.offscreen.closeDocument();
    } catch {
      // ignore if already closed
    }
  }

  // Set up the ready promise before createDocument to avoid missing the PipelineFFmpegReady signal.
  const ffmpegReady = waitForFFmpegReady();
  await browser.offscreen.createDocument({
    url: "/offscreen.html",
    reasons: [browser.offscreen.Reason.WORKERS, browser.offscreen.Reason.IFRAME_SCRIPTING],
    justification: "FFmpeg WASM mux + hidden YouTube watch iframe for grid-page downloads"
  });

  // Waiting here avoids chunks being dropped before the offscreen message handlers are ready.
  await ffmpegReady;
}

export async function ensureProcessor() {
  const isProcessorAlive = processorReady && isOffscreenConnected();
  if (isProcessorAlive) {
    return processorReady;
  }

  processorReady = ensureOffscreenDocument();
  return processorReady;
}
