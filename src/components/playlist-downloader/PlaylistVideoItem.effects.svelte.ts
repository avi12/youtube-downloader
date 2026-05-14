import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";
import { downloadProgressStore, videoDataFailedStore, videoDataStore } from "@/lib/ui/synced-stores.svelte";
import type { VideoData } from "@/types";

export function createVideoItemEffects(
  videoId: string,
  setVideoData: (value: VideoData) => void,
  setIsLoadFailed: (value: boolean) => void,
  setIsLocallyDone: (value: boolean) => void
) {
  $effect(() => {
    const entry = downloadProgressStore.get(videoId);
    if (entry?.isDone) {
      setIsLocallyDone(true); return;
    }

    if (!entry || entry.isFailed || entry.isDownloading) {
      setIsLocallyDone(false);
    }
  });

  $effect(() => {
    const storeData = videoDataStore.get(videoId);
    if (storeData) {
      setVideoData(storeData); return;
    }

    if (videoDataFailedStore.get(videoId)) {
      setIsLoadFailed(true); return;
    }

    void crossWorldMessenger.sendMessage(CrossWorldMessage.RequestVideoData, { videoId });
  });
}
