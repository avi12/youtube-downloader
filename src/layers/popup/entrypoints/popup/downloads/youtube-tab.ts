import { buildPlaylistUrl, buildWatchUrl } from "@/lib/youtube/youtube-url";

const YOUTUBE_TAB_URL_PATTERN = "*://*.youtube.com/*";
const PAGE_IDENTITY_PARAMS = ["v", "list"];

const ZIP_CONTAINER = "zip";

type BuildYouTubePageUrlParams = {
  videoId: string;
  isPlaylist?: boolean;
};
function buildYouTubePageUrl({ videoId, isPlaylist }: BuildYouTubePageUrlParams) {
  return isPlaylist ? buildPlaylistUrl(videoId) : buildWatchUrl(videoId);
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

type DownloadOrigin = {
  videoId: string;
  tabId?: number;
  sourceUrl?: string;
  isPlaylist?: boolean;
};

function isShowingOrigin(url: string | undefined, origin: DownloadOrigin) {
  if (!url) {
    return false;
  }

  return url === origin.sourceUrl || isSamePage(url, new URL(buildYouTubePageUrl(origin)));
}

const openTabUrlById = new Map<number, string>();

export async function loadOpenYouTubeTabs() {
  const tabs = await browser.tabs.query({ url: YOUTUBE_TAB_URL_PATTERN });
  for (const tab of tabs) {
    if (tab.id !== undefined && tab.url) {
      openTabUrlById.set(tab.id, tab.url);
    }
  }
}

type CurrentTab = {
  currentTabId?: number;
  currentSourceUrl?: string;
};
// The tab a download started in owns it while it still shows that page. Once it
// is closed or navigated away, any tab showing the same video or playlist does
export function isFromCurrentTab(origin: DownloadOrigin, { currentTabId, currentSourceUrl }: CurrentTab) {
  if (currentTabId === undefined || !currentSourceUrl) {
    return false;
  }

  if (origin.tabId === currentTabId) {
    return isShowingOrigin(currentSourceUrl, origin);
  }

  const originTabUrl = origin.tabId === undefined ? undefined : openTabUrlById.get(origin.tabId);
  if (isShowingOrigin(originTabUrl, origin)) {
    return false;
  }

  return isSamePage(currentSourceUrl, new URL(buildYouTubePageUrl(origin)));
}

export async function focusOrOpenTab(origin: DownloadOrigin) {
  const pageUrl = buildYouTubePageUrl(origin);
  const tabs = await browser.tabs.query({ url: YOUTUBE_TAB_URL_PATTERN });
  const originTab = tabs.find(tab => tab.id === origin.tabId && isShowingOrigin(tab.url, origin));
  const samePageTab = tabs.find(tab => tab.url && isSamePage(tab.url, new URL(pageUrl)));
  const existingTab = originTab ?? samePageTab;
  if (!existingTab) {
    await browser.tabs.create({ url: pageUrl });
    return;
  }

  await browser.tabs.update(existingTab.id, { active: true });
  await browser.windows.update(existingTab.windowId, { focused: true });
}
