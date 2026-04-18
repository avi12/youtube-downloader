let processorReady: Promise<void> | null = null;
let resolveFFmpegReady: (() => void) | null = null;
let firefoxProcessorFrame: HTMLIFrameElement | null = null;

export function signalFFmpegReady() {
  resolveFFmpegReady?.();
  resolveFFmpegReady = null;
}

async function waitForFFmpegReady() {
  return new Promise<void>(resolve => resolveFFmpegReady = resolve);
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

async function ensureFirefoxProcessorFrame() {
  if (firefoxProcessorFrame !== null && document.body.contains(firefoxProcessorFrame)) {
    return;
  }

  firefoxProcessorFrame?.remove();
  firefoxProcessorFrame = null;

  const ffmpegReady = waitForFFmpegReady();

  const elFrame = document.createElement("iframe");
  elFrame.src = browser.runtime.getURL("/offscreen.html");
  elFrame.style.display = "none";
  document.body.appendChild(elFrame);
  firefoxProcessorFrame = elFrame;

  await ffmpegReady;
}

export async function ensureProcessor() {
  if (processorReady) {
    return processorReady;
  }

  processorReady = import.meta.env.FIREFOX
    ? ensureFirefoxProcessorFrame()
    : ensureChromeOffscreenDocument();

  return processorReady;
}
