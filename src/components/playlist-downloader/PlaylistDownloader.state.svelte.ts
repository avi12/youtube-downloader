import { buildDownloadRequest, optionsToQualityValue, resolveDefaultZipName } from "./playlist-download-builder";
import { calculateBatchProgress, resolveCurrentPhaseLabel } from "./playlist-progress-helpers";
import { createRevealState } from "./PlaylistDownloader.reveal.svelte";
import { scrollVideoItemIntoView } from "./PlaylistDownloader.scroll";
import { MessageType, sendMessage } from "@/lib/messaging/messaging";
import { setOption } from "@/lib/storage/storage";
import { checkedPlaylistVideos } from "@/lib/ui/playlist-selection.svelte";
import {
  CONTENT_OPTIONS,
  downloadProgressStore,
  playlistMetadataSignal,
  videoDataStore
} from "@/lib/ui/synced-stores.svelte";
import {
  PlaylistDownloadMode,
  PlaylistOutputMode,
  ProgressType,
  VideoQualityMode,
  type DownloadRequest,
  type DownloadTypePreference,
  type VideoData
} from "@/types";
import { untrack } from "svelte";
import { SvelteMap, SvelteSet } from "svelte/reactivity";

export const batchDownloadStatus = $state({
  isRunning: false,
  isZipBatch: false
});
export const batchVideoIds = new SvelteSet<string>();
export const batchCanceledIds = new SvelteSet<string>();

let downloadMode = $state<PlaylistDownloadMode>(CONTENT_OPTIONS.value.playlistDownloadMode);
let outputMode = $state(CONTENT_OPTIONS.value.playlistOutputMode);
let isScrollSyncEnabled = $state(CONTENT_OPTIONS.value.isPlaylistScrollSyncEnabled);
let downloadTypeOverride = $state<DownloadTypePreference | null>(null);
let videoExtOverride = $state<string | null>(null);
let audioExtOverride = $state<string | null>(null);
let videoQualityOverride = $state<string | null>(null);
let zipNameOverride = $state<string | null>(null);
let currentZipBundleId = $state<string | null>(null);

export function createPlaylistDownloaderState() {
  const videoDataMap = new SvelteMap<string, VideoData>();
  let isDownloading = $state(false);
  let totalCount = $state(0);
  let error = $state("");

  const effectiveDownloadType = $derived<DownloadTypePreference>(
    downloadTypeOverride ?? CONTENT_OPTIONS.value.defaultDownloadType
  );
  const effectiveVideoExt = $derived(videoExtOverride ?? CONTENT_OPTIONS.value.ext.video);
  const effectiveAudioExt = $derived(audioExtOverride ?? CONTENT_OPTIONS.value.ext.audio);
  const effectiveQuality = $derived(videoQualityOverride ?? optionsToQualityValue(CONTENT_OPTIONS.value));
  const effectiveZipName = $derived(zipNameOverride ?? resolveDefaultZipName(playlistMetadataSignal.value));
  const isAnyOverrideActive = $derived(
    downloadTypeOverride !== null
    || videoExtOverride !== null
    || audioExtOverride !== null
    || videoQualityOverride !== null
    || zipNameOverride !== null
  );

  function buildEffectiveOptions() {
    const base = CONTENT_OPTIONS.value;
    const qualityValue = effectiveQuality;
    return {
      ...base,
      defaultDownloadType: effectiveDownloadType,
      ext: {
        video: effectiveVideoExt,
        audio: effectiveAudioExt
      },
      videoQualityMode: qualityValue === VideoQualityMode.Best
        ? VideoQualityMode.Best
        : VideoQualityMode.Custom,
      videoQuality: qualityValue === VideoQualityMode.Best ? base.videoQuality : Number(qualityValue)
    };
  }

  function resetOverrides() {
    downloadTypeOverride = null;
    videoExtOverride = null;
    audioExtOverride = null;
    videoQualityOverride = null;
    zipNameOverride = null;
  }

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

  let activeDownloadRequests = $state<DownloadRequest[]>([]);
  let completedBatchProgress = $state(0);

  const batchDoneIds = new SvelteSet<string>();

  $effect(() => {
    for (const request of activeDownloadRequests) {
      if (batchDoneIds.has(request.videoId)) {
        continue;
      }

      const entry = downloadProgressStore.get(request.videoId);
      const isEntryFinished = !entry || entry.isDone || entry.isFailed;
      if (isEntryFinished) {
        batchDoneIds.add(request.videoId);
      }
    }
  });

  const downloadedCount = $derived(
    activeDownloadRequests.filter(request => batchDoneIds.has(request.videoId)).length
  );

  const downloadButtonLabel = $derived.by(() => {
    if (isDownloading) {
      return `Downloading ${downloadedCount} of ${totalCount}`;
    }

    const count = selectedDownloadableVideos.length;
    if (count === 0) {
      return "Download selected";
    }

    return `Download ${count} video${count === 1 ? "" : "s"}`;
  });

  $effect(() => {
    const isBatchIncomplete = !isDownloading || totalCount === 0 || downloadedCount < totalCount;
    if (isBatchIncomplete) {
      return;
    }

    if (currentZipBundleId) {
      const zipEntry = downloadProgressStore.get(`zip:${currentZipBundleId}`);
      if (!zipEntry?.isDone) {
        return;
      }

      downloadProgressStore.deleteLocal(`zip:${currentZipBundleId}`);
      currentZipBundleId = null;
    }

    completedBatchProgress = 100;
    isDownloading = false;
    batchDownloadStatus.isRunning = false;
    batchDownloadStatus.isZipBatch = false;

    for (const request of activeDownloadRequests) {
      if (batchCanceledIds.has(request.videoId)) {
        continue;
      }

      downloadProgressStore.unsuppress(request.videoId);
      const entry = downloadProgressStore.get(request.videoId);
      const isEntryStillActive = entry && !entry.isDone && !entry.isFailed;
      if (isEntryStillActive) {
        downloadProgressStore.setLocal(request.videoId, {
          isDownloading: false,
          isDone: true,
          progress: 1,
          progressType: entry?.progressType ?? ProgressType.FFmpeg
        });
      }
    }

    batchVideoIds.clear();
    batchCanceledIds.clear();
  });

  async function startDownload(videos: readonly VideoData[]) {
    if (videos.length === 0) {
      return;
    }

    completedBatchProgress = 0;
    error = "";
    isDownloading = true;
    batchDownloadStatus.isRunning = true;
    batchVideoIds.clear();
    batchCanceledIds.clear();
    totalCount = videos.length;
    batchDoneIds.clear();

    for (const video of videos) {
      batchVideoIds.add(video.videoId);
      downloadProgressStore.deleteLocal(video.videoId);
      downloadProgressStore.unsuppress(video.videoId);
      downloadProgressStore.setLocal(video.videoId, {
        isDownloading: true,
        isDone: false,
        progress: 0,
        progressType: ""
      });
    }

    const metadata = playlistMetadataSignal.value;
    const playlistId = metadata?.playlistId || `playlist-${Date.now()}`;
    const isZipBundle = outputMode === PlaylistOutputMode.Zip;
    batchDownloadStatus.isZipBatch = isZipBundle;
    currentZipBundleId = isZipBundle ? playlistId : null;

    const resolvedOptions = buildEffectiveOptions();
    const downloadRequests = videos.map(data =>
      buildDownloadRequest(data, resolvedOptions, playlistId, effectiveZipName, videos.length, isZipBundle));
    activeDownloadRequests = downloadRequests;

    try {
      await sendMessage(MessageType.RequestPlaylistDownload, {
        items: downloadRequests,
        playlistTitle: effectiveZipName,
        isZipBundle,
        isSequential: downloadMode === PlaylistDownloadMode.DataSaver
      });
    } catch {
      error = "Failed to start downloads - please try again";
      isDownloading = false;
      return;
    }
  }

  async function cancelDownload() {
    const activeVideoIds = activeDownloadRequests
      .filter(request => downloadProgressStore.get(request.videoId)?.isDownloading)
      .map(request => request.videoId);
    if (activeVideoIds.length > 0) {
      await sendMessage(MessageType.CancelDownload, { videoIds: activeVideoIds });
    }

    completedBatchProgress = 0;
    isDownloading = false;
    batchDownloadStatus.isRunning = false;
    batchDownloadStatus.isZipBatch = false;
    batchVideoIds.clear();
    batchCanceledIds.clear();

    if (currentZipBundleId) {
      downloadProgressStore.deleteLocal(`zip:${currentZipBundleId}`);
      currentZipBundleId = null;
    }

    for (const request of activeDownloadRequests) {
      downloadProgressStore.delete(request.videoId);
    }
  }

  function toggleSelectedDownload() {
    if (isDownloading) {
      void cancelDownload();
    } else {
      void startDownload(selectedDownloadableVideos);
    }
  }

  function selectAll() {
    for (const video of downloadableVideos) {
      checkedPlaylistVideos.add(video.videoId);
    }
  }

  function clearSelection() {
    checkedPlaylistVideos.clear();
  }

  const reveal = createRevealState(
    () => videoDataMap.size,
    () => downloadableVideos,
    startDownload
  );

  const activeIndividualDownloadCount = $derived.by(() => {
    if (isDownloading) {
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
      isDownloading,
      activeDownloadRequests,
      videoId => downloadProgressStore.get(videoId),
      totalCount,
      currentZipBundleId,
      activeIndividualDownloadCount,
      videoDataMap.keys(),
      completedBatchProgress
    )
  );

  const activeDownloadVideoId = $derived.by(() => {
    if (!isDownloading) {
      return null;
    }

    for (const request of activeDownloadRequests) {
      const progressEntry = downloadProgressStore.get(request.videoId);
      if (progressEntry?.isDownloading) {
        return request.videoId;
      }
    }

    return null;
  });

  const currentPhaseLabel = $derived(
    resolveCurrentPhaseLabel(
      isDownloading,
      currentZipBundleId,
      downloadedCount,
      totalCount,
      activeDownloadVideoId,
      activeDownloadRequests,
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
      return isDownloading;
    },
    get downloadedCount() {
      return downloadedCount;
    },
    get totalCount() {
      return totalCount;
    },
    get error() {
      return error;
    },
    get downloadMode() {
      return downloadMode;
    },
    set downloadMode(value) {
      downloadMode = value;
      void setOption("playlistDownloadMode", value);
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
      isScrollSyncEnabled = value;
      void setOption("isPlaylistScrollSyncEnabled", value);
    },
    get effectiveDownloadType() {
      return effectiveDownloadType;
    },
    set effectiveDownloadType(value) {
      downloadTypeOverride = value === CONTENT_OPTIONS.value.defaultDownloadType ? null : value;
    },
    get effectiveVideoExt() {
      return effectiveVideoExt;
    },
    set effectiveVideoExt(value) {
      videoExtOverride = value === CONTENT_OPTIONS.value.ext.video ? null : value;
    },
    get effectiveAudioExt() {
      return effectiveAudioExt;
    },
    set effectiveAudioExt(value) {
      audioExtOverride = value === CONTENT_OPTIONS.value.ext.audio ? null : value;
    },
    get effectiveQuality() {
      return effectiveQuality;
    },
    set effectiveQuality(value) {
      videoQualityOverride = value === optionsToQualityValue(CONTENT_OPTIONS.value) ? null : value;
    },
    get isAnyOverrideActive() {
      return isAnyOverrideActive;
    },
    get activeIndividualDownloadCount() {
      return activeIndividualDownloadCount;
    },
    get totalProgress() {
      return totalProgress;
    },
    get completedBatchProgress() {
      return completedBatchProgress;
    },
    get currentPhaseLabel() {
      return currentPhaseLabel;
    },
    get isDownloadTypeOverridden() {
      return downloadTypeOverride !== null;
    },
    get isVideoExtOverridden() {
      return videoExtOverride !== null;
    },
    get isAudioExtOverridden() {
      return audioExtOverride !== null;
    },
    get isQualityOverridden() {
      return videoQualityOverride !== null;
    },
    get effectiveZipName() {
      return effectiveZipName;
    },
    set effectiveZipName(value) {
      const trimmed = value.trim();
      zipNameOverride = !trimmed || trimmed === resolveDefaultZipName(playlistMetadataSignal.value) ? null : trimmed;
    },
    get isZipNameOverridden() {
      return zipNameOverride !== null;
    },
    resetOverrides,
    toggleSelectedDownload,
    revealAndDownloadAll: reveal.revealAndDownloadAll,
    cancelReveal: reveal.cancelReveal,
    selectAll,
    clearSelection
  };
}
