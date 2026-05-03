import { extractPoTokenFromBody } from "./proto-parser";

export { extractPoTokenFromBody };

const SESSION_STORAGE_KEY = "sabrCaptures";

type CapturedEntry = {
  body: number[];
  url: string;
  tabId: number;
  timestamp: number;
};

const capturedByTab = new Map<number, CapturedEntry>();

let offscreenCapture: CapturedEntry | null = null;
const offscreenCaptureResolvers = new Set<(capture: CapturedEntry) => void>();

let onCaptureCallback: ((tabId: number) => void) | null = null;

export function onSabrBodyCaptured(callback: (tabId: number) => void) {
  onCaptureCallback = callback;
}

function persistCaptures() {
  const entries = Object.fromEntries(capturedByTab);
  void browser.storage.session.set({ [SESSION_STORAGE_KEY]: entries });
}

function isCapturedEntry(value: unknown): value is CapturedEntry {
  if (!value || typeof value !== "object") {
    return false;
  }

  if (!("tabId" in value) || typeof value.tabId !== "number") {
    return false;
  }

  if (!("url" in value) || typeof value.url !== "string") {
    return false;
  }

  if (!("timestamp" in value) || typeof value.timestamp !== "number") {
    return false;
  }

  return "body" in value && Array.isArray(value.body);
}

async function loadPersistedCaptures() {
  const result = await browser.storage.session.get(SESSION_STORAGE_KEY);
  const raw = result[SESSION_STORAGE_KEY];
  if (!raw || typeof raw !== "object") {
    return;
  }

  for (const value of Object.values(raw)) {
    if (isCapturedEntry(value)) {
      capturedByTab.set(value.tabId, value);
    }
  }
}

function handleSabrRequest(details: Browser.webRequest.OnBeforeRequestDetails) {
  if (!details.requestBody?.raw?.[0]?.bytes) {
    return undefined;
  }

  const bodyBytes = new Uint8Array(details.requestBody.raw[0].bytes);
  if (details.tabId < 0) {
    const entry: CapturedEntry = {
      body: Array.from(bodyBytes),
      url: details.url,
      tabId: -1,
      timestamp: Date.now()
    };
    offscreenCapture = entry;
    for (const resolve of offscreenCaptureResolvers) {
      resolve(entry);
    }
    offscreenCaptureResolvers.clear();
    return undefined;
  }

  const previousData = capturedByTab.get(details.tabId);
  const isFirstCapture = !previousData;

  capturedByTab.set(details.tabId, {
    body: Array.from(bodyBytes),
    url: details.url,
    tabId: details.tabId,
    timestamp: Date.now()
  });
  persistCaptures();

  const isPreviousPoToken = previousData
    ? Boolean(extractPoTokenFromBody(previousData.body))
    : false;

  const isPoTokenPresent = Boolean(extractPoTokenFromBody(Array.from(bodyBytes)));
  const isNewPoToken = isPoTokenPresent && !isPreviousPoToken;
  if (isFirstCapture || isNewPoToken) {
    onCaptureCallback?.(details.tabId);
  }
}

export async function startSabrRequestCapture() {
  await loadPersistedCaptures();
  browser.webRequest.onBeforeRequest.addListener(
    handleSabrRequest,
    { urls: ["https://*.googlevideo.com/videoplayback*"] },
    ["requestBody"]
  );
  browser.tabs.onRemoved.addListener(tabId => {
    capturedByTab.delete(tabId);
    persistCaptures();
  });
}

export function getCapturedSabrData(tabId: number) {
  return capturedByTab.get(tabId) ?? offscreenCapture ?? getLatestCapturedSabrData();
}

function getLatestCapturedSabrData() {
  let latest: CapturedEntry | undefined;

  for (const entry of capturedByTab.values()) {
    if (!latest || entry.timestamp > latest.timestamp) {
      latest = entry;
    }
  }

  return latest ?? null;
}

export function clearCapturedSabrData(tabId: number) {
  capturedByTab.delete(tabId);
  persistCaptures();
}

export function hasCapturedSabrDataForTab(tabId: number): boolean {
  return capturedByTab.has(tabId);
}

function waitForOffscreenSabrCapture(timeoutMs: number): Promise<CapturedEntry | null> {
  if (offscreenCapture) {
    return Promise.resolve(offscreenCapture);
  }

  return new Promise(resolve => {
    function onCapture(capture: CapturedEntry) {
      clearTimeout(timer);
      resolve(capture);
    }
    const timer = setTimeout(() => {
      offscreenCaptureResolvers.delete(onCapture);
      resolve(null);
    }, timeoutMs);
    offscreenCaptureResolvers.add(onCapture);
  });
}

function clearOffscreenCapture() {
  offscreenCapture = null;
}

export function setOffscreenCapture(body: number[], url: string) {
  offscreenCapture = {
    body,
    url,
    tabId: -1,
    timestamp: Date.now()
  };
}
