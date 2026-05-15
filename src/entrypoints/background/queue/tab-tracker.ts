import { OffscreenMessageType, sendToOffscreen } from "@/lib/messaging/offscreen-messaging";
import type { VideoTabParams } from "@/types";

const videoIdToTabIds: Record<string, number[]> = {};
export const tabTracker: Record<number, {
  videoIdsAvailable: string[];
}> = {};

export function trackVideoForTab({ videoId, tabId }: VideoTabParams) {
  videoIdToTabIds[videoId] ??= [];

  const isTabNotTracked = !videoIdToTabIds[videoId].includes(tabId);
  if (isTabNotTracked) {
    videoIdToTabIds[videoId].push(tabId);
  }

  tabTracker[tabId] ??= { videoIdsAvailable: [] };

  const isVideoNotTracked = !tabTracker[tabId].videoIdsAvailable.includes(videoId);
  if (isVideoNotTracked) {
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

export function resolveTabId({ sender, videoId }: {
  sender: {
    tab?: { id?: number };
  };
  videoId: string;
}) {
  return sender.tab?.id ?? getTabIdsForVideo(videoId)[0];
}

export async function cancelDownloads(videoIds: string[]) {
  sendToOffscreen({
    type: OffscreenMessageType.CancelProcessing,
    data: {
      videoIds
    }
  });
}
