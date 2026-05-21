import { tabTracker, untrackVideoForTab } from "../queue/tab-tracker";
import { clearCapturedSabrData } from "@/lib/youtube/sabr/request-capture";

const YOUTUBE_HOSTNAME = "youtube.com";

export function registerTabLifecycleHandlers() {
  browser.tabs.onRemoved.addListener(tabId => {
    const tabState = tabTracker[tabId];
    if (!tabState) {
      return;
    }

    delete tabTracker[tabId];
    clearCapturedSabrData(tabId);

    for (const videoId of tabState.videoIdsAvailable) {
      untrackVideoForTab({
        videoId,
        tabId
      });
    }
  });

  browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    const isLoading = changeInfo.status === browser.tabs.TabStatus.LOADING;
    const isYouTube = (tab.url ?? "").includes(YOUTUBE_HOSTNAME);
    const isYouTubeLoading = isLoading && isYouTube;
    if (!isYouTubeLoading) {
      return;
    }

    const tabState = tabTracker[tabId];
    if (!tabState) {
      return;
    }

    for (const videoId of tabState.videoIdsAvailable) {
      untrackVideoForTab({
        videoId,
        tabId
      });
    }

    clearCapturedSabrData(tabId);
    tabTracker[tabId] = { videoIdsAvailable: [] };
  });
}
