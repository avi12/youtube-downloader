import { checkedPlaylistVideos } from "@/lib/ui/playlist-selection.svelte";
import { videoDataStore } from "@/lib/ui/synced-stores.svelte";
import type { VideoData } from "@/types";
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

  const availableQualities = $derived.by(() => {
    const allHeights: number[] = [];
    for (const data of videoDataMap.values()) {
      for (const format of data.videoFormats) {
        if (format.height) {
          allHeights.push(format.height);
        }
      }
    }
    allHeights.sort((heightA, heightB) => heightB - heightA);
    return allHeights.filter((height, iHeight) => iHeight === 0 || height !== allHeights[iHeight - 1]);
  });

  const guaranteedQuality = $derived.by(() => {
    if (videoDataMap.size === 0) {
      return 0;
    }

    let minimum = Infinity;
    for (const data of videoDataMap.values()) {
      let videoMax = 0;
      for (const format of data.videoFormats) {
        const height = format.height ?? 0;
        if (height > videoMax) {
          videoMax = height;
        }
      }

      if (videoMax < minimum) {
        minimum = videoMax;
      }
    }
    return minimum === Infinity ? 0 : minimum;
  });

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
