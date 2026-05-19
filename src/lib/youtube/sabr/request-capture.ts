import { extractPoTokenFromBody } from "./po-token-extractor";

export { extractPoTokenFromBody } from "./po-token-extractor";

// Requests from offscreen iframes (youtube.com, tabId < 0) use this sentinel key.
// These must be captured separately because tabId < 0 normally means "extension request"
// and is skipped - but offscreen iframe player requests also arrive with tabId < 0.
export const OFFSCREEN_PLAYER_TAB_ID = -2;

const GOOGLEVIDEO_URL_PATTERN = "https://*.googlevideo.com/videoplayback*";
const YOUTUBE_ORIGIN = "https://www.youtube.com";

const capturedByTab = new Map<number, {
  body: number[];
  url: string;
  tabId: number;
  timestamp: number;
}>();

export function startSabrRequestCapture() {
  browser.webRequest.onBeforeRequest.addListener(
    handleSabrRequest,
    { urls: [GOOGLEVIDEO_URL_PATTERN] },
    ["requestBody"]
  );
  browser.tabs.onRemoved.addListener(tabId => capturedByTab.delete(tabId));
}

let onCaptureCallback: ((tabId: number) => void) | null = null;

export function onSabrBodyCaptured(callback: (tabId: number) => void) {
  onCaptureCallback = callback;
}

function handleSabrRequest(details: Browser.webRequest.OnBeforeRequestDetails) {
  // Background requests with youtube.com initiator come from offscreen iframe players.
  // Capture them so playlist iframes get the player's actual (n-param-decoded) URL.
  const isOffscreenPlayer = details.tabId < 0
    && details.initiator === YOUTUBE_ORIGIN;
  const isExtensionRequest = details.tabId < 0 && !isOffscreenPlayer;
  if (isExtensionRequest) {
    return undefined;
  }

  const captureTabId = isOffscreenPlayer ? OFFSCREEN_PLAYER_TAB_ID : details.tabId;

  const hasNoBody = !details.requestBody?.raw?.[0]?.bytes;
  if (hasNoBody) {
    return undefined;
  }

  const bodyBytes = new Uint8Array(details.requestBody!.raw![0].bytes!);
  const previousData = capturedByTab.get(captureTabId);
  const isFirstCapture = !previousData;

  capturedByTab.set(captureTabId, {
    body: Array.from(bodyBytes),
    url: details.url,
    tabId: captureTabId,
    timestamp: Date.now()
  });

  const isPreviousPoToken = previousData
    ? Boolean(extractPoTokenFromBody(previousData.body))
    : false;

  const isPoTokenPresent = Boolean(extractPoTokenFromBody(Array.from(bodyBytes)));
  const isNewPoToken = isPoTokenPresent && !isPreviousPoToken;
  if (isFirstCapture || isNewPoToken) {
    onCaptureCallback?.(captureTabId);
  }
}

export function getCapturedSabrData(tabId: number) {
  return capturedByTab.get(tabId) ?? getLatestCapturedSabrData();
}

function getLatestCapturedSabrData() {
  let latest: ReturnType<typeof capturedByTab.get>;

  for (const entry of capturedByTab.values()) {
    const isNewerEntry = !latest || entry.timestamp > latest.timestamp;
    if (isNewerEntry) {
      latest = entry;
    }
  }

  return latest ?? null;
}

export function clearCapturedSabrData(tabId: number) {
  capturedByTab.delete(tabId);
}
