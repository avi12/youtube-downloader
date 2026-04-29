import { tabTracker, untrackVideoForTab } from "../queue/tab-tracker";
import { notifyFirefoxProcessorTabRemoved } from "./processor";
import { clearCapturedSabrData } from "@/lib/youtube/sabr/request-capture";

export function registerTabLifecycleHandlers() {
  browser.tabs.onRemoved.addListener(tabId => {
    if (import.meta.env.FIREFOX) {
      notifyFirefoxProcessorTabRemoved(tabId);
    }

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
    if (changeInfo.status !== browser.tabs.TabStatus.LOADING || !(tab.url ?? "").includes("youtube.com")) {
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
