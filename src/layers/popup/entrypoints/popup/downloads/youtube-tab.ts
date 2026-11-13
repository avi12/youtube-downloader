import { buildPlaylistUrl, buildWatchUrl } from "@/lib/youtube/youtube-url";
import type { RecentDownloadEntry, VideoDetail } from "@/types";

const YOUTUBE_TAB_URL_PATTERN = "*://*.youtube.com/*";
const PAGE_IDENTITY_PARAMS = ["v", "list"];

const ZIP_CONTAINER = "zip";

interface BuildYouTubePageUrlParams {
  videoId: string;
  isPlaylist?: boolean;
}
function buildYouTubePageUrl({ videoId, isPlaylist }: BuildYouTubePageUrlParams) {
  return isPlaylist ? buildPlaylistUrl(videoId) : buildWatchUrl(videoId);
}

function isZipContainer(container: string) {
  return container === ZIP_CONTAINER;
}

function isSamePage({ candidateUrl, targetUrl }: { candidateUrl: string; targetUrl: URL }) {
  const candidate = URL.parse(candidateUrl);
  if (!candidate || candidate.pathname !== targetUrl.pathname) {
    return false;
  }

  return PAGE_IDENTITY_PARAMS
    .filter(param => targetUrl.searchParams.has(param))
    .every(param => candidate.searchParams.get(param) === targetUrl.searchParams.get(param));
}

interface DownloadOrigin {
  videoId: string;
  tabId?: number;
  sourceUrl?: string;
  isPlaylist?: boolean;
}

function isShowingOrigin({ url, origin }: { url: string | undefined; origin: DownloadOrigin }) {
  if (!url) {
    return false;
  }

  return url === origin.sourceUrl || isSamePage({
     candidateUrl: url,
     targetUrl: new URL(buildYouTubePageUrl(origin)) 
  });
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

interface CurrentTab {
  currentTabId?: number;
  currentSourceUrl?: string;
}
// The tab a download started in owns it while it still shows that page. Once it
// is closed or navigated away, any tab showing the same video or playlist does
function isFromCurrentTab({ origin, currentTabId, currentSourceUrl }: { origin: DownloadOrigin } & CurrentTab) {
  if (currentTabId === undefined || !currentSourceUrl) {
    return false;
  }

  if (origin.tabId === currentTabId) {
    return isShowingOrigin({
       url: currentSourceUrl,
       origin 
    });
  }

  const originTabUrl = origin.tabId === undefined ? undefined : openTabUrlById.get(origin.tabId);
  if (isShowingOrigin({
     url: originTabUrl,
     origin 
  })) {
    return false;
  }

  return isSamePage({
     candidateUrl: currentSourceUrl,
     targetUrl: new URL(buildYouTubePageUrl(origin)) 
  });
}

export async function focusOrOpenTab(origin: DownloadOrigin) {
  const pageUrl = buildYouTubePageUrl(origin);
  const tabs = await browser.tabs.query({ url: YOUTUBE_TAB_URL_PATTERN });
  const originTab = tabs.find(tab => tab.id === origin.tabId && isShowingOrigin({
     url: tab.url,
     origin 
  }));
  const samePageTab = tabs.find(tab => tab.url && isSamePage({
     candidateUrl: tab.url,
     targetUrl: new URL(pageUrl) 
  }));
  const existingTab = originTab ?? samePageTab;
  if (!existingTab) {
    await browser.tabs.create({ url: pageUrl });
    return;
  }

  await browser.tabs.update(existingTab.id, { active: true });
  await browser.windows.update(existingTab.windowId, { focused: true });
}

export function toRecentOrigin(entry: RecentDownloadEntry) {
  return {
    ...entry,
    isPlaylist: isZipContainer(entry.container)
  };
}

export function isRecentFromCurrentTab({ entry, currentTab }: { entry: RecentDownloadEntry; currentTab: CurrentTab }) {
  return isFromCurrentTab({
     origin: toRecentOrigin(entry),
     ...currentTab 
  });
}

interface ActiveDownload {
  videoId: string;
  detail?: VideoDetail;
}
export function isActiveFromCurrentTab({ currentTab, videoId, detail }: { currentTab: CurrentTab } & ActiveDownload) {
  return isFromCurrentTab({
 origin: {
    ...detail,
    videoId
  },
     ...currentTab 
});
}
