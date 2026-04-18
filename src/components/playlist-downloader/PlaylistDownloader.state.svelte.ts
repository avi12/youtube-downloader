import { createRevealState } from "./PlaylistDownloader.reveal.svelte";
import { scrollVideoItemIntoView } from "./PlaylistDownloader.scroll";
import { MessageType, sendMessage } from "@/lib/messaging/messaging";
import { checkedPlaylistVideos } from "@/lib/ui/playlist-selection.svelte";
import {
  contentOptions,
  downloadProgressStore,
  playlistMetadataSignal,
  videoDataStore
} from "@/lib/ui/synced-stores.svelte";
import { resolveVideoFilename } from "@/lib/utils/containers";
import { calculateWeightedProgress } from "@/lib/youtube/video-helpers";
import {
  DownloadType,
  PlaylistDownloadMode,
  PlaylistOutputMode,
  ProgressType,
  VideoQualityMode,
  type DownloadRequest,
  type DownloadTypePreference,
  type Options,
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

// User-facing preferences live at module scope so they survive any re-mount
// of the panel (e.g. when YouTube rebuilds the header subtree on theme
// transitions and our mount container gets re-created).
let downloadMode = $state<PlaylistDownloadMode>(PlaylistDownloadMode.Fast);
let outputMode = $state(PlaylistOutputMode.Zip);
let isScrollSyncEnabled = $state(false);
let downloadTypeOverride = $state<DownloadTypePreference | null>(null);
let videoExtOverride = $state<string | null>(null);
let audioExtOverride = $state<string | null>(null);
let videoQualityOverride = $state<string | null>(null);
let zipNameOverride = $state<string | null>(null);
let currentZipBundleId = $state<string | null>(null);

function resolveDefaultZipName() {
  const metadata = playlistMetadataSignal.value;
  if (metadata?.playlistTitle) {
    return metadata.playlistTitle;
  }

  if (metadata?.playlistOwner) {
    return `${metadata.playlistOwner}'s playlist`;
  }

  return "Playlist";
}

// Maps popup quality settings to a single PolymerSelect-compatible value.
// "best" means always pick the highest bitrate; a numeric string (e.g. "1080")
// means pick that resolution and fall back to best if unavailable.
// CurrentQuality is watch-page-only, so it maps to "best" in playlist context.
function optionsToQualityValue(options: Options) {
  return options.videoQualityMode === VideoQualityMode.Custom
    ? String(options.videoQuality)
    : VideoQualityMode.Best;
}

function buildDownloadRequest(
  data: VideoData,
  options: Options,
  playlistId: string,
  playlistTitle: string,
  playlistTotalCount: number,
  isZipBundle: boolean
): DownloadRequest {
  let downloadType: DownloadType = data.isMusic ? DownloadType.Audio : DownloadType.VideoAndAudio;
  if (options.defaultDownloadType !== "auto") {
    downloadType = options.defaultDownloadType;
  }

  const videoFormat = options.videoQualityMode === VideoQualityMode.Best
    ? data.videoFormats[0]
    : (data.videoFormats.find(format => format.height === options.videoQuality) ?? data.videoFormats[0]);

  return {
    type: downloadType,
    videoId: data.videoId,
    videoItag: videoFormat?.itag ?? 0,
    audioItag: data.audioFormats[0]?.itag ?? 0,
    filenameOutput: resolveVideoFilename({
      videoData: data,
      options
    }),
    sabrConfig: data.sabrConfig,
    ...(isZipBundle && {
      playlistId,
      playlistTitle,
      playlistTotalCount
    })
  };
}

export function createPlaylistDownloaderState() {
  const videoDataMap = new SvelteMap<string, VideoData>();
  let isDownloading = $state(false);
  let totalCount = $state(0);
  let error = $state("");

  const effectiveDownloadType = $derived<DownloadTypePreference>(
    downloadTypeOverride ?? contentOptions.value.defaultDownloadType
  );
  const effectiveVideoExt = $derived(videoExtOverride ?? contentOptions.value.ext.video);
  const effectiveAudioExt = $derived(audioExtOverride ?? contentOptions.value.ext.audio);
  const effectiveQuality = $derived(videoQualityOverride ?? optionsToQualityValue(contentOptions.value));
  const effectiveZipName = $derived(zipNameOverride ?? resolveDefaultZipName());
  const isAnyOverrideActive = $derived(
    downloadTypeOverride !== null
    || videoExtOverride !== null
    || audioExtOverride !== null
    || videoQualityOverride !== null
    || zipNameOverride !== null
  );

  function buildEffectiveOptions() {
    const base = contentOptions.value;
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

  // Highest resolution found across all videos - drives which quality options are shown.
  // Kept separate from guaranteedQuality so it can be evaluated independently during reveal.
  const maxAvailableQuality = $derived.by(() => {
    let max = 0;
    for (const data of videoDataMap.values()) {
      for (const format of data.videoFormats) {
        const height = format.height ?? 0;
        if (height > max) {
          max = height;
        }
      }
    }
    return max;
  });

  // Lowest of each video's personal best - drives "Up to" label qualifier.
  // Kept as a separate lazy derived so it is never evaluated during reveal:
  // PlaylistDownloaderFormatSections short-circuits it with isRevealingAll.
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

  // Sticky set: once a batch video is done (completed or cancelled), it stays
  // done even if the user re-downloads it individually during the same batch.
  // This prevents individually-restarted videos from extending the batch.
  const batchDoneIds = new SvelteSet<string>();

  $effect(() => {
    for (const request of activeDownloadRequests) {
      if (batchDoneIds.has(request.videoId)) {
        continue;
      }

      const entry = downloadProgressStore.get(request.videoId);
      if (!entry || entry.isDone || entry.isFailed) {
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
    if (!isDownloading || totalCount === 0 || downloadedCount < totalCount) {
      return;
    }

    // For zip batches, hold here until the packaging step signals completion.
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
      if (entry && !entry.isDone && !entry.isFailed) {
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

    // Use setLocal to batch-initialise progress without firing a cross-world
    // sync message per video - prevents N separate reactive cycles across all
    // PlaylistVideoItem components when starting a large playlist download.
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

  const totalProgress = $derived.by(() => {
    if (isDownloading && totalCount > 0) {
      let sum = 0;
      for (const request of activeDownloadRequests) {
        const entry = downloadProgressStore.get(request.videoId);
        if (!entry || !entry.isDownloading) {
          sum += 100;
          continue;
        }

        sum += calculateWeightedProgress({
          isDownloading: entry.isDownloading,
          progress: entry.progress,
          progressType: entry.progressType
        });
      }

      // Zip packaging is an extra step after all downloads complete.
      // Treat it as one additional slot so the bar only reaches 100 when
      // the zip is actually ready to download.
      if (currentZipBundleId) {
        const zipEntry = downloadProgressStore.get(`zip:${currentZipBundleId}`);
        sum += zipEntry?.isDone ? 100 : 0;
        return sum / (totalCount + 1);
      }

      return sum / totalCount;
    }

    if (activeIndividualDownloadCount > 0) {
      let sum = 0;
      for (const videoId of videoDataMap.keys()) {
        const entry = downloadProgressStore.get(videoId);
        if (entry?.isDownloading) {
          sum += calculateWeightedProgress({
            isDownloading: entry.isDownloading,
            progress: entry.progress,
            progressType: entry.progressType
          });
        }
      }
      return sum / activeIndividualDownloadCount;
    }

    return completedBatchProgress;
  });

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
    },
    get outputMode() {
      return outputMode;
    },
    set outputMode(value) {
      outputMode = value;
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
    get maxAvailableQuality() {
      return maxAvailableQuality;
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
    },
    get effectiveDownloadType() {
      return effectiveDownloadType;
    },
    set effectiveDownloadType(value) {
      downloadTypeOverride = value === contentOptions.value.defaultDownloadType ? null : value;
    },
    get effectiveVideoExt() {
      return effectiveVideoExt;
    },
    set effectiveVideoExt(value) {
      videoExtOverride = value === contentOptions.value.ext.video ? null : value;
    },
    get effectiveAudioExt() {
      return effectiveAudioExt;
    },
    set effectiveAudioExt(value) {
      audioExtOverride = value === contentOptions.value.ext.audio ? null : value;
    },
    get effectiveQuality() {
      return effectiveQuality;
    },
    set effectiveQuality(value) {
      videoQualityOverride = value === optionsToQualityValue(contentOptions.value) ? null : value;
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
      zipNameOverride = !trimmed || trimmed === resolveDefaultZipName() ? null : trimmed;
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
