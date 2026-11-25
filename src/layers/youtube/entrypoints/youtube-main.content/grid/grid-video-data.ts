import { videoDataCache } from "@/layers/youtube/entrypoints/youtube-main.content/video/video-data";
import { fetchVideoDataViaApi } from "./grid-video-fetch";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";
import { videoDataFailedStore, videoDataStore } from "@/lib/ui/synced-stores.svelte";
import { createLogger, LogScope } from "@/lib/utils/logger";

const log = createLogger(LogScope.Main);

const MAX_CONCURRENT_FETCHES = 3;
const FETCH_TIMEOUT_MS = 15_000;
const videoDataPending = new Set<string>();
let activeVideoDataFetches = 0;

function rejectAfter(milliseconds: number) {
  return new Promise<never>((_, reject) => {
    const signal = AbortSignal.timeout(milliseconds);
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}

async function processNextVideoData() {
  const isAtCapacity = activeVideoDataFetches >= MAX_CONCURRENT_FETCHES;
  const isPendingEmpty = videoDataPending.size === 0;
  if (isAtCapacity || isPendingEmpty) {
    return;
  }

  const { value: videoId } = videoDataPending.values().next();
  if (!videoId) {
    return;
  }

  videoDataPending.delete(videoId);
  activeVideoDataFetches++;

  try {
    await Promise.race([fetchVideoDataViaApi(videoId), rejectAfter(FETCH_TIMEOUT_MS)]);

    if (!videoDataCache.has(videoId)) {
      videoDataFailedStore.set(videoId, true);
    }
  } catch (error) {
    log.warn("Failed to fetch video data for", videoId, error);
    videoDataFailedStore.set(videoId, true);
  } finally {
    activeVideoDataFetches--;
    processNextVideoData().catch(() => {});
  }
}

function requestVideoData(videoId: string) {
  const cachedVideoData = videoDataCache.get(videoId);
  if (cachedVideoData) {
    videoDataStore.set(videoId, cachedVideoData);
    return;
  }

  const isVideoPending = videoDataPending.has(videoId);
  if (!isVideoPending) {
    videoDataPending.add(videoId);
    processNextVideoData().catch(() => {});
  }
}

export function registerGridVideoDataHandler() {
  crossWorldMessenger.onMessage(CrossWorldMessage.RequestVideoData, ({ data }) => {
    requestVideoData(data.videoId);
  });
}
