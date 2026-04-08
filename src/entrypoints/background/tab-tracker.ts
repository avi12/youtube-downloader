import { sendMessage } from "../../lib/messaging";
import { MessageType } from "../../lib/messaging";

export const videoIdToTabIds: Record<string, number[]> = {};
export const tabTracker: Record<number, { videoIdsAvailable: string[] }> = {};

export function trackVideoForTab(videoId: string, tabId: number) {
  if (!videoIdToTabIds[videoId]) {
    videoIdToTabIds[videoId] = [tabId];
  } else if (!videoIdToTabIds[videoId].includes(tabId)) {
    videoIdToTabIds[videoId].push(tabId);
  }
}

export function untrackVideoForTab(videoId: string, tabId: number) {
  if (!videoIdToTabIds[videoId]) {
    return;
  }

  videoIdToTabIds[videoId] = videoIdToTabIds[videoId].filter(id => id !== tabId);
}

export async function cancelDownloads(videoIds: string[]) {
  await sendMessage(MessageType.CancelProcessing, { videoIds });
}
