import { extractPoTokenFromBody } from "./proto-parser";

export { extractPoTokenFromBody };

const capturedByTab = new Map<number, {
  body: number[];
  url: string;
  tabId: number;
  timestamp: number;
}>();

let onCaptureCallback: ((tabId: number) => void) | null = null;

export function onSabrBodyCaptured(callback: (tabId: number) => void) {
  onCaptureCallback = callback;
}

function handleSabrRequest(details: Browser.webRequest.OnBeforeRequestDetails) {
  if (details.tabId < 0) {
    return undefined;
  }

  if (!details.requestBody?.raw?.[0]?.bytes) {
    return undefined;
  }

  const bodyBytes = new Uint8Array(details.requestBody.raw[0].bytes);
  const previousData = capturedByTab.get(details.tabId);
  const isFirstCapture = !previousData;

  capturedByTab.set(details.tabId, {
    body: Array.from(bodyBytes),
    url: details.url,
    tabId: details.tabId,
    timestamp: Date.now()
  });

  const isPreviousPoToken = previousData
    ? Boolean(extractPoTokenFromBody(previousData.body))
    : false;

  const isPoTokenPresent = Boolean(extractPoTokenFromBody(Array.from(bodyBytes)));
  const isNewPoToken = isPoTokenPresent && !isPreviousPoToken;
  if (isFirstCapture || isNewPoToken) {
    onCaptureCallback?.(details.tabId);
  }
}

export function startSabrRequestCapture() {
  browser.webRequest.onBeforeRequest.addListener(
    handleSabrRequest,
    { urls: ["https://*.googlevideo.com/videoplayback*"] },
    ["requestBody"]
  );
  browser.tabs.onRemoved.addListener(tabId => capturedByTab.delete(tabId));
}

export function getCapturedSabrData(tabId: number) {
  return capturedByTab.get(tabId) ?? getLatestCapturedSabrData();
}

function getLatestCapturedSabrData() {
  let latest: ReturnType<typeof capturedByTab.get>;

  for (const entry of capturedByTab.values()) {
    if (!latest || entry.timestamp > latest.timestamp) {
      latest = entry;
    }
  }

  return latest ?? null;
}

export function clearCapturedSabrData(tabId: number) {
  capturedByTab.delete(tabId);
}
