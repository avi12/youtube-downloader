import { broadcastDebugLogToYouTubeTabs } from "@/lib/messaging/debug-log";

let processorReady: Promise<void> | null = null;
let resolveFFmpegReady: (() => void) | null = null;

export function signalFFmpegReady() {
  void broadcastDebugLogToYouTubeTabs("[ytdl:processor] signalFFmpegReady called");
  resolveFFmpegReady?.();
  resolveFFmpegReady = null;
}

async function waitForFFmpegReady() {
  return new Promise<void>(resolve => {
    resolveFFmpegReady = resolve;
  });
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
    try {
      await browser.offscreen.closeDocument();
    } catch {
      // already closed
    }
  }

  // Set up the ready promise BEFORE createDocument so we can't miss
  // the PipelineFFmpegReady signal that fires right after initialization.
  const ffmpegReady = waitForFFmpegReady();
  await browser.offscreen.createDocument({
    url: "/offscreen.html",
    reasons: [browser.offscreen.Reason.WORKERS],
    justification: "FFmpeg WASM processing requires a Worker context"
  });

  await ffmpegReady;
}

export async function ensureProcessor() {
  if (processorReady) {
    return processorReady;
  }

  processorReady = ensureChromeOffscreenDocument();
  return processorReady;
}
