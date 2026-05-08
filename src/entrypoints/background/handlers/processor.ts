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
    // getContexts not available in all environments
  }

  if (existingContexts.length > 0) {
    try {
      await browser.offscreen.closeDocument();
    } catch {
      // Already closed
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

  // Offscreen's onMessage handlers aren't registered until createFFmpegCore({}) resolves,
  // so waiting here avoids chunks being dropped right after createDocument().
  await ffmpegReady;
}

export async function ensureProcessor() {
  if (processorReady) {
    return processorReady;
  }

  processorReady = ensureOffscreenDocument();
  return processorReady;
}
