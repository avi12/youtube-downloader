import { clearCapturedSabrData } from "../../lib/sabr-request-capture";
import { isFirefoxProcessorTab, resetProcessorState } from "./processor";
import { cancelDownloads, tabTracker, untrackVideoForTab } from "./tab-tracker";

enum TabStatus {
  Loading = "loading"
}

export function registerTabLifecycleHandlers() {
  browser.tabs.onRemoved.addListener(async tabId => {
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

    await cancelDownloads(tabState.videoIdsAvailable);
  });

  browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.status !== TabStatus.Loading || !tab.url?.includes("youtube.com")) {
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
    await cancelDownloads(tabState.videoIdsAvailable);
    tabTracker[tabId] = { videoIdsAvailable: [] };
  });
}
