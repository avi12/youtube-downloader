import { broadcastDebugLogToYouTubeTabs } from "@/lib/messaging/debug-log";
import { isFFmpegReadyItem } from "@/lib/storage/storage";

let processorReady: Promise<void> | null = null;
let resolveFFmpegReady: (() => void) | null = null;

export function signalFFmpegReady() {
  void broadcastDebugLogToYouTubeTabs("[ytdl:processor] signalFFmpegReady called");
  resolveFFmpegReady?.();
  resolveFFmpegReady = null;
}

function waitForFFmpegReady() {
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

// Firefox MV3 background runs as an event page with a real DOM. We inject
// offscreen.html as a hidden iframe in the background page's document instead
// of opening a separate browser tab. Firefox auto-injects content scripts into
// the scrub iframes (youtube.com URLs) inside the offscreen iframe because
// all_frames:true matching is per-frame URL, not per-tab top URL.
async function ensureFirefoxProcessorFrame() {
  const processorUrl = browser.runtime.getURL("/offscreen.html");
  const SELECTOR = "iframe[data-ytdl-processor]";
  if (document.querySelector(SELECTOR)) {
    const isAlreadyReady = await isFFmpegReadyItem.getValue();
    if (isAlreadyReady) {
      void broadcastDebugLogToYouTubeTabs("[ytdl:processor] re-attached to existing frame, FFmpeg already ready");
      return;
    }

    void broadcastDebugLogToYouTubeTabs("[ytdl:processor] re-attached to existing frame, awaiting FFmpeg ready");
    await Promise.race([
      waitForFFmpegReady(),
      new Promise<void>(resolve => setTimeout(resolve, 60_000))
    ]);
    return;
  }

  await isFFmpegReadyItem.setValue(false);
  void broadcastDebugLogToYouTubeTabs("[ytdl:processor] injecting processor frame into background page");
  const ffmpegReady = waitForFFmpegReady();

  const iframe = document.createElement("iframe");
  iframe.setAttribute("data-ytdl-processor", "1");
  iframe.src = processorUrl;
  iframe.hidden = true;
  document.body.appendChild(iframe);

  await ffmpegReady;
  void broadcastDebugLogToYouTubeTabs("[ytdl:processor] FFmpeg ready");
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
