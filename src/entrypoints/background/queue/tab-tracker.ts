import { OffscreenMessageType, sendToOffscreen } from "@/lib/messaging/offscreen-messaging";
import type { Prettify, VideoTabParams } from "@/types";

const videoIdToTabIds: Record<string, number[]> = {};
export const tabTracker: Record<number, {
  videoIdsAvailable: string[];
}> = {};

export function trackVideoForTab({ videoId, tabId }: VideoTabParams) {
  videoIdToTabIds[videoId] ??= [];

  const isTabAlreadyTracked = videoIdToTabIds[videoId].includes(tabId);
  if (!isTabAlreadyTracked) {
    videoIdToTabIds[videoId].push(tabId);
  }

  tabTracker[tabId] ??= { videoIdsAvailable: [] };

  const isVideoAlreadyTracked = tabTracker[tabId].videoIdsAvailable.includes(videoId);
  if (!isVideoAlreadyTracked) {
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

type ResolveTabIdParams = Prettify<{
  sender: {
    tab?: { id?: number };
  };
  videoId: string;
}>;
export function resolveTabId({ sender, videoId }: ResolveTabIdParams) {
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
