import { tabTracker, untrackVideoForTab } from "../queue/tab-tracker";
import { clearCapturedSabrData } from "@/lib/youtube/sabr/request-capture";

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
    const isNotLoading = changeInfo.status !== browser.tabs.TabStatus.LOADING;
    const isNotYouTube = !(tab.url ?? "").includes("youtube.com");
    if (isNotLoading || isNotYouTube) {
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
