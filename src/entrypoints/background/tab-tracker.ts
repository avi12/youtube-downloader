import { MessageType, sendMessage } from "@/lib/messaging";

const videoIdToTabIds: Record<string, number[]> = {};
export const tabTracker: Record<number, { videoIdsAvailable: string[] }> = {};

export function trackVideoForTab(videoId: string, tabId: number) {
  videoIdToTabIds[videoId] ??= [];

  if (!videoIdToTabIds[videoId].includes(tabId)) {
    videoIdToTabIds[videoId].push(tabId);
  }

  tabTracker[tabId] ??= { videoIdsAvailable: [] };

  if (!tabTracker[tabId].videoIdsAvailable.includes(videoId)) {
    tabTracker[tabId].videoIdsAvailable.push(videoId);
  }
}

export function untrackVideoForTab(videoId: string, tabId: number) {
  if (!videoIdToTabIds[videoId]) {
    return;
  }

  const iTabId = videoIdToTabIds[videoId].indexOf(tabId);
  if (iTabId !== -1) {
    videoIdToTabIds[videoId].splice(iTabId, 1);
  }
}

export async function cancelDownloads(videoIds: string[]) {
  await sendMessage(MessageType.CancelProcessing, { videoIds });
}
