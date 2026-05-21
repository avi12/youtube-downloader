import { extractPoTokenFromBody } from "./po-token-extractor";

export { extractPoTokenFromBody } from "./po-token-extractor";

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
  const isBackgroundTab = details.tabId < 0;
  const isYouTubeInitiator = details.initiator === YOUTUBE_ORIGIN;
  const isOffscreenPlayer = isBackgroundTab && isYouTubeInitiator;
  const isExtensionRequest = isBackgroundTab && !isOffscreenPlayer;
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
  const shouldNotifyCapture = isFirstCapture || isNewPoToken;
  if (shouldNotifyCapture) {
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
