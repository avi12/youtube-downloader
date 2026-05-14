import { videoDataCache } from "../video/video-data";
import { fetchVideoDataViaApi } from "./grid-video-fetch";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";
import { videoDataFailedStore, videoDataStore } from "@/lib/ui/synced-stores.svelte";

const MAX_CONCURRENT_FETCHES = 3;
const videoDataPending = new Set<string>();
let activeVideoDataFetches = 0;

async function processNextVideoData() {
  if (activeVideoDataFetches >= MAX_CONCURRENT_FETCHES || videoDataPending.size === 0) {
    return;
  }

  const { value: videoId } = videoDataPending.values().next();
  if (!videoId) {
    return;
  }

  videoDataPending.delete(videoId);
  activeVideoDataFetches++;

  try {
    await fetchVideoDataViaApi(videoId);

    if (!videoDataCache.has(videoId)) {
      videoDataFailedStore.set(videoId, true);
    }
  } catch (error) {
    console.warn("[ytdl] Failed to fetch video data for", videoId, error);
    videoDataFailedStore.set(videoId, true);
  } finally {
    activeVideoDataFetches--;
    void processNextVideoData();
  }
}

function requestVideoData(videoId: string) {
  const cachedVideoData = videoDataCache.get(videoId);
  if (cachedVideoData) {
    videoDataStore.set(videoId, cachedVideoData);
    return;
  }

  if (!videoDataPending.has(videoId)) {
    videoDataPending.add(videoId);
    void processNextVideoData();
  }
}

export function registerGridVideoDataHandler() {
  crossWorldMessenger.onMessage(CrossWorldMessage.RequestVideoData, ({ data }) => {
    requestVideoData(data.videoId);
  });
}
