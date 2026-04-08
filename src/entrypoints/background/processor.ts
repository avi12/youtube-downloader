let processorReady: Promise<void> | null = null;
let firefoxProcessorTabId: number | null = null;

export function isFirefoxProcessorTab(tabId: number) {
  return tabId === firefoxProcessorTabId;
}

export function resetProcessorState() {
  processorReady = null;
  firefoxProcessorTabId = null;
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
    return;
  }

  await browser.offscreen.createDocument({
    url: "/offscreen.html",
    reasons: [browser.offscreen.Reason.WORKERS],
    justification: "FFmpeg WASM processing requires a Worker context"
  });
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

  const tab = await browser.tabs.create({
    url: browser.runtime.getURL("/offscreen.html"),
    active: false
  });

  firefoxProcessorTabId = tab.id ?? null;
}

export function ensureProcessor() {
  if (processorReady) {
    return processorReady;
  }

  processorReady = import.meta.env.FIREFOX
    ? ensureFirefoxProcessorTab()
    : ensureChromeOffscreenDocument();

  return processorReady;
}
