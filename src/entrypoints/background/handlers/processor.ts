import { broadcastDebugLogToYouTubeTabs } from "@/lib/messaging/debug-log";
import { isFFmpegReadyItem } from "@/lib/storage/storage";

let processorReady: Promise<void> | null = null;
let resolveFFmpegReady: (() => void) | null = null;
let firefoxProcessorTabId: number | null = null;

export function signalFFmpegReady() {
  void broadcastDebugLogToYouTubeTabs("[ytdl:processor] signalFFmpegReady called");
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

// Firefox MV3 background pages are event-driven and restart every ~60s. We
// open offscreen.html as a persistent tab so WASM compilation survives restarts.
// On each restart we query for an existing processor tab instead of killing it -
// WASM takes >60s to compile, so killing on restart would loop forever.
async function ensureFirefoxProcessorTab() {
  const processorUrl = browser.runtime.getURL("/offscreen.html");

  // Re-attach to an existing processor tab surviving from before this BG restart.
  const existingTabs = await browser.tabs.query({ url: processorUrl });
  if (existingTabs.length > 0 && existingTabs[0].id !== undefined) {
    firefoxProcessorTabId = existingTabs[0].id;

    const isAlreadyReady = await isFFmpegReadyItem.getValue();
    if (isAlreadyReady) {
      void broadcastDebugLogToYouTubeTabs(`[ytdl:processor] re-attached to tab ${firefoxProcessorTabId}, FFmpeg already ready`);
      return;
    }

    void broadcastDebugLogToYouTubeTabs(`[ytdl:processor] re-attached to tab ${firefoxProcessorTabId}, awaiting FFmpeg ready`);
    // Race: the processor may have already sent PipelineFFmpegReady before
    // this BG restart. It will retry every 3s, so 60s is plenty.
    await Promise.race([
      waitForFFmpegReady(),
      new Promise<void>(resolve => setTimeout(resolve, 60_000))
    ]);

    // Double-check the flag after the race in case the timeout won but the
    // processor's retry landed in the mean time.
    if (await isFFmpegReadyItem.getValue()) {
      return;
    }

    // Processor tab is alive but stuck - close it and let the next branch create a fresh one.
    void broadcastDebugLogToYouTubeTabs(`[ytdl:processor] tab ${firefoxProcessorTabId} timed out, reopening`);
    await browser.tabs.remove(firefoxProcessorTabId).catch(() => {});
    firefoxProcessorTabId = null;
    // Fall through to the "no existing tab" path by calling ourselves recursively.
    await ensureFirefoxProcessorTab();
    return;
  }

  // No existing tab - create one. Reset the ready flag so stale storage
  // from a previous extension load doesn't cause a false-ready signal.
  await isFFmpegReadyItem.setValue(false);
  void broadcastDebugLogToYouTubeTabs("[ytdl:processor] creating new processor tab");
  const ffmpegReady = waitForFFmpegReady();
  const tab = await browser.tabs.create({
    url: processorUrl,
    active: false
  });
  firefoxProcessorTabId = tab.id ?? null;
  void broadcastDebugLogToYouTubeTabs(`[ytdl:processor] processor tab created id=${firefoxProcessorTabId}, awaiting FFmpeg ready`);
  await ffmpegReady;
  void broadcastDebugLogToYouTubeTabs("[ytdl:processor] FFmpeg ready");
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

export function getFirefoxProcessorTabId(): number | null {
  return firefoxProcessorTabId;
}

export function notifyFirefoxProcessorTabRemoved(tabId: number) {
  if (tabId !== firefoxProcessorTabId) {
    return;
  }

  firefoxProcessorTabId = null;
  processorReady = null;
}
