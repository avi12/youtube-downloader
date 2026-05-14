import { resolveDefaultZipName } from "./playlist-download-builder";
import { calculateBatchProgress, resolveCurrentPhaseLabel } from "./playlist-progress-helpers";
import { createBatchDownloadState } from "./PlaylistDownloader.batch.svelte";
import { createOverrideState } from "./PlaylistDownloader.overrides.svelte";
import { createRevealState } from "./PlaylistDownloader.reveal.svelte";
import { scrollVideoItemIntoView } from "./PlaylistDownloader.scroll";
import { setOption } from "@/lib/storage/storage";
import { checkedPlaylistVideos } from "@/lib/ui/playlist-selection.svelte";
import {
  CONTENT_OPTIONS,
  downloadProgressStore,
  playlistMetadataSignal,
  videoDataStore
} from "@/lib/ui/synced-stores.svelte";
import { PlaylistDownloadMode, VideoQualityMode, type VideoData } from "@/types";
import { untrack } from "svelte";
import { SvelteMap } from "svelte/reactivity";

let downloadMode = $state<PlaylistDownloadMode>(CONTENT_OPTIONS.value.playlistDownloadMode);
let outputMode = $state(CONTENT_OPTIONS.value.playlistOutputMode);
let isScrollSyncEnabled = $state(CONTENT_OPTIONS.value.isPlaylistScrollSyncEnabled);

export function createPlaylistDownloaderState() {
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

  $effect.pre(() => {
    downloadMode = CONTENT_OPTIONS.value.playlistDownloadMode;
    outputMode = isAllMusicPlaylist
      ? CONTENT_OPTIONS.value.playlistAudioOutputMode
      : CONTENT_OPTIONS.value.playlistOutputMode;
    isScrollSyncEnabled = CONTENT_OPTIONS.value.isPlaylistScrollSyncEnabled;
  });

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

    let min = Infinity;
    for (const data of videoDataMap.values()) {
      let videoMax = 0;
      for (const format of data.videoFormats) {
        const height = format.height ?? 0;
        if (height > videoMax) {
          videoMax = height;
        }
      }

      if (videoMax < min) {
        min = videoMax;
      }
    }
    return min === Infinity ? 0 : min;
  });

  const selectedDownloadableVideos = $derived(
    downloadableVideos.filter(data => checkedPlaylistVideos.has(data.videoId))
  );
  const isAllSelected = $derived(
    downloadableVideos.length > 0 && selectedDownloadableVideos.length === downloadableVideos.length
  );

  const overrides = createOverrideState(() => resolveDefaultZipName(playlistMetadataSignal.value));

  function buildEffectiveOptions() {
    const base = CONTENT_OPTIONS.value;
    const qualityValue = overrides.effectiveQuality;
    return {
      ...base,
      defaultDownloadType: overrides.effectiveDownloadType,
      ext: {
        video: overrides.effectiveVideoExt,
        audio: overrides.effectiveAudioExt
      },
      videoQualityMode: qualityValue === VideoQualityMode.Best ? VideoQualityMode.Best : VideoQualityMode.Custom,
      videoQuality: qualityValue === VideoQualityMode.Best ? base.videoQuality : Number(qualityValue)
    };
  }

  const batch = createBatchDownloadState(
    () => outputMode,
    () => downloadMode,
    buildEffectiveOptions,
    () => overrides.effectiveZipName
  );

  const downloadButtonLabel = $derived.by(() => {
    if (batch.isDownloading) {
      return `Downloading ${batch.downloadedCount} of ${batch.totalCount}`;
    }

    const count = selectedDownloadableVideos.length;
    return count === 0 ? "Download selected" : `Download ${count} video${count === 1 ? "" : "s"}`;
  });

  const reveal = createRevealState(
    () => videoDataMap.size,
    () => downloadableVideos,
    batch.startDownload
  );

  const activeIndividualDownloadCount = $derived.by(() => {
    if (batch.isDownloading) {
      return 0;
    }

    let count = 0;
    for (const videoId of videoDataMap.keys()) {
      if (downloadProgressStore.get(videoId)?.isDownloading) {
        count++;
      }
    }
    return count;
  });

  const totalProgress = $derived(
    calculateBatchProgress(
      batch.isDownloading,
      batch.activeDownloadRequests,
      videoId => downloadProgressStore.get(videoId),
      batch.totalCount,
      batch.currentZipBundleId,
      activeIndividualDownloadCount,
      videoDataMap.keys(),
      batch.completedBatchProgress
    )
  );

  const activeDownloadVideoId = $derived.by(() => {
    if (!batch.isDownloading) {
      return null;
    }

    for (const request of batch.activeDownloadRequests) {
      if (downloadProgressStore.get(request.videoId)?.isDownloading) {
        return request.videoId;
      }
    }

    return null;
  });

  const currentPhaseLabel = $derived(
    resolveCurrentPhaseLabel(
      batch.isDownloading,
      batch.currentZipBundleId,
      batch.downloadedCount,
      batch.totalCount,
      activeDownloadVideoId,
      batch.activeDownloadRequests,
      videoId => downloadProgressStore.get(videoId),
      videoId => videoDataMap.get(videoId)
    )
  );

  $effect(() => {
    if (!isScrollSyncEnabled || !activeDownloadVideoId) {
      return;
    }

    scrollVideoItemIntoView(activeDownloadVideoId);
  });

  return {
    get isDownloading() {
      return batch.isDownloading;
    },
    get downloadedCount() {
      return batch.downloadedCount;
    },
    get totalCount() {
      return batch.totalCount;
    },
    get error() {
      return batch.error;
    },
    get downloadMode() {
      return downloadMode;
    },
    set downloadMode(value) {
      downloadMode = value; void setOption("playlistDownloadMode", value);
    },
    get outputMode() {
      return outputMode;
    },
    set outputMode(value) {
      outputMode = value;
      void setOption(isAllMusicPlaylist ? "playlistAudioOutputMode" : "playlistOutputMode", value);
    },
    get downloadableVideos() {
      return downloadableVideos;
    },
    get nonDownloadableCount() {
      return nonDownloadableCount;
    },
    get selectedDownloadableVideos() {
      return selectedDownloadableVideos;
    },
    get isAllSelected() {
      return isAllSelected;
    },
    get downloadButtonLabel() {
      return downloadButtonLabel;
    },
    get availableQualities() {
      return availableQualities;
    },
    get guaranteedQuality() {
      return guaranteedQuality;
    },
    get isRevealingAll() {
      return reveal.isRevealingAll;
    },
    get revealedVideoCount() {
      return reveal.revealedVideoCount;
    },
    get isScrollSyncEnabled() {
      return isScrollSyncEnabled;
    },
    set isScrollSyncEnabled(value) {
      isScrollSyncEnabled = value; void setOption("isPlaylistScrollSyncEnabled", value);
    },
    get effectiveDownloadType() {
      return overrides.effectiveDownloadType;
    },
    set effectiveDownloadType(value) {
      overrides.effectiveDownloadType = value;
    },
    get effectiveVideoExt() {
      return overrides.effectiveVideoExt;
    },
    set effectiveVideoExt(value) {
      overrides.effectiveVideoExt = value;
    },
    get effectiveAudioExt() {
      return overrides.effectiveAudioExt;
    },
    set effectiveAudioExt(value) {
      overrides.effectiveAudioExt = value;
    },
    get effectiveQuality() {
      return overrides.effectiveQuality;
    },
    set effectiveQuality(value) {
      overrides.effectiveQuality = value;
    },
    get isAnyOverrideActive() {
      return overrides.isAnyOverrideActive;
    },
    get activeIndividualDownloadCount() {
      return activeIndividualDownloadCount;
    },
    get totalProgress() {
      return totalProgress;
    },
    get completedBatchProgress() {
      return batch.completedBatchProgress;
    },
    get currentPhaseLabel() {
      return currentPhaseLabel;
    },
    get isDownloadTypeOverridden() {
      return overrides.isDownloadTypeOverridden;
    },
    get isVideoExtOverridden() {
      return overrides.isVideoExtOverridden;
    },
    get isAudioExtOverridden() {
      return overrides.isAudioExtOverridden;
    },
    get isQualityOverridden() {
      return overrides.isQualityOverridden;
    },
    get effectiveZipName() {
      return overrides.effectiveZipName;
    },
    set effectiveZipName(value) {
      overrides.effectiveZipName = value;
    },
    get isZipNameOverridden() {
      return overrides.isZipNameOverridden;
    },
    resetOverrides: overrides.resetOverrides,
    toggleSelectedDownload: () => batch.isDownloading
      ? void batch.cancelDownload()
      : void batch.startDownload(selectedDownloadableVideos),
    revealAndDownloadAll: reveal.revealAndDownloadAll,
    cancelReveal: reveal.cancelReveal,
    selectAll() {
      for (const video of downloadableVideos) {
        checkedPlaylistVideos.add(video.videoId);
      }
    },
    clearSelection: () => checkedPlaylistVideos.clear()
  };
}
