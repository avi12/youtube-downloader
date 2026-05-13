import { OffscreenMessageType, sendToOffscreen } from "@/lib/messaging/offscreen-messaging";
import type { VideoTabParams } from "@/types";

const videoIdToTabIds: Record<string, number[]> = {};
export const tabTracker: Record<number, {
  videoIdsAvailable: string[];
}> = {};

export function trackVideoForTab({ videoId, tabId }: VideoTabParams) {
  videoIdToTabIds[videoId] ??= [];

  if (!videoIdToTabIds[videoId].includes(tabId)) {
    videoIdToTabIds[videoId].push(tabId);
  }

  tabTracker[tabId] ??= { videoIdsAvailable: [] };

  if (!tabTracker[tabId].videoIdsAvailable.includes(videoId)) {
    tabTracker[tabId].videoIdsAvailable.push(videoId);
  }
}

export function untrackVideoForTab({ videoId, tabId }: VideoTabParams) {
  if (!videoIdToTabIds[videoId]) {
    return;
  }

  const iTabId = videoIdToTabIds[videoId].indexOf(tabId);
  if (iTabId !== -1) {
    videoIdToTabIds[videoId].splice(iTabId, 1);
  }
}

export function getTabIdsForVideo(videoId: string) {
  return videoIdToTabIds[videoId] ?? [];
}

export async function cancelDownloads(videoIds: string[]) {
  sendToOffscreen(OffscreenMessageType.CancelProcessing, { videoIds });
}
