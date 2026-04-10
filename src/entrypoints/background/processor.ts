let processorReady: Promise<void> | null = null;
let firefoxProcessorTabId: number | null = null;
let resolveFFmpegReady: (() => void) | null = null;

export function isFirefoxProcessorTab(tabId: number) {
  return tabId === firefoxProcessorTabId;
}

export function resetProcessorState() {
  processorReady = null;
  firefoxProcessorTabId = null;
  resolveFFmpegReady = null;
}

// Called by pipeline-handlers when the offscreen document signals FFmpeg is loaded.
// Resolves processorReady so pending chunk sends can proceed.
export function signalFFmpegReady() {
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
      // Already closed
    }
  }

  // Set up the FFmpeg-ready promise BEFORE createDocument so we can't miss
  // the PipelineFFmpegReady signal that fires right after FFmpeg initializes.
  const ffmpegReady = waitForFFmpegReady();
  await browser.offscreen.createDocument({
    url: "/offscreen.html",
    reasons: [browser.offscreen.Reason.WORKERS],
    justification: "FFmpeg WASM processing requires a Worker context"
  });

  // Wait until initFFmpeg() fires PipelineFFmpegReady → signalFFmpegReady().
  // Without this, chunks forwarded right after createDocument() are dropped
  // because the offscreen's onMessage handlers aren't registered until after
  // the top-level `await createFFmpegCore({})` resolves.
  await ffmpegReady;
}

async function ensureFirefoxProcessorTab() {
  if (firefoxProcessorTabId !== null) {
    try {
      await browser.tabs.get(firefoxProcessorTabId);
      return;
    } catch {
      firefoxProcessorTabId = null;
    }
  }

  const ffmpegReady = waitForFFmpegReady();
  const tab = await browser.tabs.create({
    url: browser.runtime.getURL("/offscreen.html"),
    active: false
  });

  firefoxProcessorTabId = tab.id ?? null;
  await ffmpegReady;
}

export async function ensureProcessor() {
  if (processorReady) {
    return processorReady;
  }

  processorReady = import.meta.env.FIREFOX
    ? ensureFirefoxProcessorTab()
    : ensureChromeOffscreenDocument();

  return processorReady;
}
