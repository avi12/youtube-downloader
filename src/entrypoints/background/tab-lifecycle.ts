import { isFirefoxProcessorTab, resetProcessorState } from "./processor";
import { tabTracker, untrackVideoForTab } from "./tab-tracker";
import { clearCapturedSabrData } from "@/lib/sabr-request-capture";

export function registerTabLifecycleHandlers() {
  browser.tabs.onRemoved.addListener(tabId => {
    if (isFirefoxProcessorTab(tabId)) {
      resetProcessorState();
      return;
    }

    const tabState = tabTracker[tabId];
    if (!tabState) {
      return;
    }

    delete tabTracker[tabId];
    clearCapturedSabrData(tabId);

    for (const videoId of tabState.videoIdsAvailable) {
      untrackVideoForTab(videoId, tabId);
    }
  });

  browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status !== browser.tabs.TabStatus.LOADING || !tab.url?.includes("youtube.com")) {
      return;
    }

    const tabState = tabTracker[tabId];
    if (!tabState) {
      return;
    }

    for (const videoId of tabState.videoIdsAvailable) {
      untrackVideoForTab(videoId, tabId);
    }

    clearCapturedSabrData(tabId);
    tabTracker[tabId] = { videoIdsAvailable: [] };
  });
}
