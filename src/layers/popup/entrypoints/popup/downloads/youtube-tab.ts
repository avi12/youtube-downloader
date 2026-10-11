const YOUTUBE_TAB_URL_PATTERN = "*://*.youtube.com/*";
const PAGE_IDENTITY_PARAMS = ["v", "list"];

const YOUTUBE_ORIGIN = "https://www.youtube.com";
const ZIP_CONTAINER = "zip";

type BuildYouTubePageUrlParams = {
  videoId: string;
  isPlaylist?: boolean;
};
export function buildYouTubePageUrl({ videoId, isPlaylist }: BuildYouTubePageUrlParams) {
  return isPlaylist ? `${YOUTUBE_ORIGIN}/playlist?list=${videoId}` : `${YOUTUBE_ORIGIN}/watch?v=${videoId}`;
}

export function isZipContainer(container: string) {
  return container === ZIP_CONTAINER;
}

function isSamePage(candidateUrl: string, targetUrl: URL) {
  const candidate = URL.parse(candidateUrl);
  if (!candidate || candidate.pathname !== targetUrl.pathname) {
    return false;
  }

  return PAGE_IDENTITY_PARAMS
    .filter(param => targetUrl.searchParams.has(param))
    .every(param => candidate.searchParams.get(param) === targetUrl.searchParams.get(param));
}

type FocusTabParams = {
  id?: number;
  windowId: number;
};
export async function focusTab({ id, windowId }: FocusTabParams) {
  await browser.tabs.update(id, { active: true });
  await browser.windows.update(windowId, { focused: true });
}

export async function focusOrOpenTab(url: string) {
  const targetUrl = new URL(url);
  const tabs = await browser.tabs.query({ url: YOUTUBE_TAB_URL_PATTERN });
  const existingTab = tabs.find(tab => tab.url && isSamePage(tab.url, targetUrl));
  if (!existingTab) {
    await browser.tabs.create({ url });
    return;
  }

  await focusTab(existingTab);
}

type CurrentTab = {
  currentTabId?: number;
  currentSourceUrl?: string;
};
type DownloadOrigin = {
  videoId: string;
  tabId?: number;
  sourceUrl?: string;
  isPlaylist?: boolean;
};
// A download belongs to the current tab when it started there, or when the
// tab now shows the same video or playlist (e.g. after closing and reopening it)
export function isFromCurrentTab(origin: DownloadOrigin, { currentTabId, currentSourceUrl }: CurrentTab) {
  if (currentTabId === undefined || !currentSourceUrl) {
    return false;
  }

  const isStartedHere = origin.tabId === currentTabId && origin.sourceUrl === currentSourceUrl;
  return isStartedHere || isSamePage(currentSourceUrl, new URL(buildYouTubePageUrl(origin)));
}
