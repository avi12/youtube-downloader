import { findGuaranteedHeight, listAvailableHeights } from "./helpers/playlist-quality-helpers";
import { videoDataStore } from "@/lib/ui/synced-stores.svelte";
import type { VideoData } from "@/types";
import { checkedPlaylistVideos } from "#youtube/lib/ui/playlist-selection.svelte";
import { untrack } from "svelte";
import { SvelteMap } from "svelte/reactivity";

export function createVideoDataState() {
  const videoDataMap = new SvelteMap<string, VideoData>();

  $effect(() => {
    for (const videoId of videoDataStore.keys()) {
      const data = videoDataStore.get(videoId);
      if (data) {
        untrack(() => {
          videoDataMap.set(videoId, data);
        });
      }
    }
  });

  const downloadableVideos = $derived([...videoDataMap.values()].filter(data => data.isDownloadable));
  const nonDownloadableCount = $derived(videoDataMap.size - downloadableVideos.length);
  const isAllMusicPlaylist = $derived(
    downloadableVideos.length > 0 && downloadableVideos.every(video => video.isMusic)
  );

  const availableQualities = $derived(listAvailableHeights(videoDataMap.values()));
  const guaranteedQuality = $derived(findGuaranteedHeight(videoDataMap.values()));

  const selectedDownloadableVideos = $derived(
    downloadableVideos.filter(data => checkedPlaylistVideos.has(data.videoId))
  );
  const isAllSelected = $derived(
    downloadableVideos.length > 0 && selectedDownloadableVideos.length === downloadableVideos.length
  );

  return {
    get videoDataMap() {
      return videoDataMap;
    },
    get downloadableVideos() {
      return downloadableVideos;
    },
    get nonDownloadableCount() {
      return nonDownloadableCount;
    },
    get isAllMusicPlaylist() {
      return isAllMusicPlaylist;
    },
    get availableQualities() {
      return availableQualities;
    },
    get guaranteedQuality() {
      return guaranteedQuality;
    },
    get selectedDownloadableVideos() {
      return selectedDownloadableVideos;
    },
    get isAllSelected() {
      return isAllSelected;
    }
  };
}
