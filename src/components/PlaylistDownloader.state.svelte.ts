import { createRevealState } from "./PlaylistDownloader.reveal.svelte";
import { scrollVideoItemIntoView } from "./PlaylistDownloader.scroll";
import { resolveVideoFilename } from "@/lib/containers";
import { MessageType, sendMessage } from "@/lib/messaging";
import { checkedPlaylistVideos } from "@/lib/playlist-selection.svelte";
import {
  contentOptions,
  downloadProgressStore,
  playlistMetadataSignal,
  videoDataStore
} from "@/lib/synced-stores.svelte";
import {
  DownloadType,
  PlaylistDownloadMode,
  PlaylistOutputMode,
  VideoQualityMode,
  type DownloadRequest,
  type DownloadTypePreference,
  type Options,
  type VideoData
} from "@/types";
import { SvelteMap, SvelteSet } from "svelte/reactivity";

// Shared across every PlaylistVideoItem so they can disable their checkboxes
// during a batch download without needing a prop chain.
export const batchDownloadStatus = $state({ isRunning: false });

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
    filenameOutput: resolveVideoFilename(data, options),
    sabrConfig: data.sabrConfig,
    ...(isZipBundle && { playlistId, playlistTitle, playlistTotalCount })
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
  const hasAnyOverride = $derived(
    downloadTypeOverride !== null
    || videoExtOverride !== null
    || audioExtOverride !== null
    || videoQualityOverride !== null
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
  }

  $effect(() => {
    for (const videoId of videoDataStore.keys()) {
      const data = videoDataStore.get(videoId);
      if (data && !videoDataMap.has(videoId)) {
        videoDataMap.set(videoId, data);
      }
    }
  });

  const downloadableVideos = $derived([...videoDataMap.values()].filter(data => data.isDownloadable));
  const nonDownloadableCount = $derived(videoDataMap.size - downloadableVideos.length);

  // Tracks the highest video resolution discovered so far across all playlist videos.
  // Grows as more video data loads (e.g. on scroll), never shrinks - so quality
  // options only expand, preventing confusing option removal mid-session.
  const maxAvailableHeight = $derived.by(() => {
    let max = 0;
    for (const data of videoDataMap.values()) {
      for (const format of data.videoFormats) {
        if ((format.height ?? 0) > max) {
          max = format.height ?? 0;
        }
      }
    }
    return max;
  });
  const selectedDownloadableVideos = $derived(
    downloadableVideos.filter(data => checkedPlaylistVideos.has(data.videoId))
  );
  const isAllSelected = $derived(
    downloadableVideos.length > 0 && selectedDownloadableVideos.length === downloadableVideos.length
  );

  let activeDownloadRequests = $state<DownloadRequest[]>([]);

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
      if (!entry || entry.isDone) {
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

    isDownloading = false;
    batchDownloadStatus.isRunning = false;
  });

  async function startDownload(videos: readonly VideoData[]) {
    if (videos.length === 0) {
      return;
    }

    error = "";
    isDownloading = true;
    batchDownloadStatus.isRunning = true;
    totalCount = videos.length;
    batchDoneIds.clear();

    for (const video of videos) {
      downloadProgressStore.unsuppress(video.videoId);
      downloadProgressStore.set(video.videoId, {
        isDownloading: true,
        isDone: false,
        progress: 0,
        progressType: ""
      });
    }

    const metadata = playlistMetadataSignal.value;
    const playlistTitle = metadata?.playlistTitle || "Playlist";
    const playlistId = metadata?.playlistId || `playlist-${Date.now()}`;
    const isZipBundle = outputMode === PlaylistOutputMode.Zip;

    const resolvedOptions = buildEffectiveOptions();
    const downloadRequests = videos.map(data =>
      buildDownloadRequest(data, resolvedOptions, playlistId, playlistTitle, videos.length, isZipBundle));
    activeDownloadRequests = downloadRequests;

    try {
      await sendMessage(MessageType.RequestPlaylistDownload, {
        items: downloadRequests,
        playlistTitle,
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

    isDownloading = false;
    batchDownloadStatus.isRunning = false;

    for (const videoId of activeVideoIds) {
      downloadProgressStore.delete(videoId);
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

  // Count of playlist videos being downloaded individually (outside of a batch).
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
        // A missing entry means the video finished and was removed from the store.
        sum += entry?.progress ?? 1;
      }
      return sum / totalCount;
    }

    if (activeIndividualDownloadCount > 0) {
      let sum = 0;
      for (const videoId of videoDataMap.keys()) {
        const entry = downloadProgressStore.get(videoId);
        if (entry?.isDownloading) {
          sum += entry.progress;
        }
      }
      return sum / activeIndividualDownloadCount;
    }

    return 0;
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
    get videoDataMapSize() {
      return videoDataMap.size;
    },
    get maxAvailableHeight() {
      return maxAvailableHeight;
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
    get hasAnyOverride() {
      return hasAnyOverride;
    },
    get activeIndividualDownloadCount() {
      return activeIndividualDownloadCount;
    },
    get totalProgress() {
      return totalProgress;
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
    resetOverrides,
    toggleSelectedDownload,
    revealAndDownloadAll: reveal.revealAndDownloadAll,
    cancelReveal: reveal.cancelReveal,
    selectAll,
    clearSelection
  };
}
