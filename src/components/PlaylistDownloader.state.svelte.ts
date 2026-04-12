import { revealAllPlaylistVideos, scrollVideoItemIntoView } from "./PlaylistDownloader.scroll";
import { MessageType, sendMessage } from "@/lib/messaging";
import { checkedPlaylistVideos } from "@/lib/playlist-selection.svelte";
import { musicListItem, videoOnlyListItem, videoQueueItem } from "@/lib/storage";
import { downloadProgressStore, playlistMetadataSignal, videoDataStore } from "@/lib/synced-stores.svelte";
import { resolveVideoFilename } from "@/lib/utils";
import {
  DownloadType,
  PlaylistDownloadMode,
  PlaylistOutputMode,
  type DownloadRequest,
  type Options,
  type VideoData
} from "@/types";
import { SvelteMap } from "svelte/reactivity";

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

  return {
    type: downloadType,
    videoId: data.videoId,
    videoItag: data.videoFormats[0]?.itag ?? 0,
    audioItag: data.audioFormats[0]?.itag ?? 0,
    filenameOutput: resolveVideoFilename(data, options),
    sabrConfig: data.sabrConfig,
    ...(isZipBundle && { playlistId, playlistTitle, playlistTotalCount })
  };
}

export function createPlaylistDownloaderState(getOptions: () => Options) {
  const videoDataMap = new SvelteMap<string, VideoData>();
  let isDownloading = $state(false);
  let downloadedCount = $state(0);
  let totalCount = $state(0);
  let error = $state("");
  let downloadMode = $state(PlaylistDownloadMode.Fast);
  let outputMode = $state(PlaylistOutputMode.Zip);
  let isRevealingAll = $state(false);
  let revealedVideoCount = $state(0);
  let isScrollSyncEnabled = $state(false);
  let shouldStartDownloadAfterReveal = false;
  let abortReveal = false;

  // Sync video data from the synced store as each playlist item reports in
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
  const selectedDownloadableVideos = $derived(
    downloadableVideos.filter(data => checkedPlaylistVideos.has(data.videoId))
  );
  const isAllSelected = $derived(
    downloadableVideos.length > 0 && selectedDownloadableVideos.length === downloadableVideos.length
  );

  const downloadButtonLabel = $derived.by(() => {
    if (isDownloading) {
      return `Downloading ${downloadedCount}/${totalCount}`;
    }

    const count = selectedDownloadableVideos.length;
    if (count === 0) {
      return "Select videos to download";
    }

    return `Download ${count} video${count === 1 ? "" : "s"}`;
  });

  function watchCompletion(downloadRequests: DownloadRequest[]) {
    async function checkCompletion() {
      const [queueValues, musicValues, videoOnlyValues] = await Promise.all([
        videoQueueItem.getValue(),
        musicListItem.getValue(),
        videoOnlyListItem.getValue()
      ]);

      const remaining = downloadRequests.filter(request =>
        queueValues.some(item => item.videoId === request.videoId) ||
          musicValues.includes(request.videoId) ||
          videoOnlyValues.includes(request.videoId)).length;

      downloadedCount = totalCount - remaining;

      if (remaining === 0) {
        isDownloading = false;
        for (const unwatch of unwatches) {
          unwatch();
        }
      }
    }

    const unwatches = [
      videoQueueItem.watch(() => checkCompletion()),
      musicListItem.watch(() => checkCompletion()),
      videoOnlyListItem.watch(() => checkCompletion())
    ];
  }

  let activeDownloadRequests: DownloadRequest[] = [];

  async function startDownload(videos: readonly VideoData[]) {
    if (videos.length === 0) {
      return;
    }

    error = "";
    isDownloading = true;
    totalCount = videos.length;
    downloadedCount = 0;

    const metadata = playlistMetadataSignal.value;
    const playlistTitle = metadata?.playlistTitle || "Playlist";
    const playlistId = metadata?.playlistId || `playlist-${Date.now()}`;
    const isZipBundle = outputMode === PlaylistOutputMode.Zip;

    const downloadRequests = videos.map(data =>
      buildDownloadRequest(data, getOptions(), playlistId, playlistTitle, videos.length, isZipBundle));
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

    watchCompletion(downloadRequests);
  }

  async function cancelDownload() {
    const videoIds = activeDownloadRequests.map(request => request.videoId);
    await sendMessage(MessageType.CancelDownload, { videoIds });
    isDownloading = false;
    downloadedCount = 0;
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

  async function revealAllVideos() {
    if (isRevealingAll) {
      return;
    }

    isRevealingAll = true;
    abortReveal = false;
    revealedVideoCount = videoDataMap.size;

    await revealAllPlaylistVideos(
      update => {
        revealedVideoCount = update.revealedCount;
      },
      () => abortReveal
    );

    isRevealingAll = false;

    if (abortReveal) {
      shouldStartDownloadAfterReveal = false;
      return;
    }

    if (shouldStartDownloadAfterReveal) {
      shouldStartDownloadAfterReveal = false;
      await startDownload(downloadableVideos);
    }
  }

  function cancelReveal() {
    abortReveal = true;
  }

  async function revealAndDownloadAll() {
    shouldStartDownloadAfterReveal = true;
    await revealAllVideos();
  }

  const activeDownloadVideoId = $derived.by(() => {
    if (!isDownloading || downloadMode !== PlaylistDownloadMode.DataSaver) {
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
    get isRevealingAll() {
      return isRevealingAll;
    },
    get revealedVideoCount() {
      return revealedVideoCount;
    },
    get isScrollSyncEnabled() {
      return isScrollSyncEnabled;
    },
    set isScrollSyncEnabled(value) {
      isScrollSyncEnabled = value;
    },
    toggleSelectedDownload,
    revealAndDownloadAll,
    cancelReveal,
    selectAll,
    clearSelection
  };
}
