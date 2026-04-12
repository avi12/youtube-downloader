import { MessageType, sendMessage } from "@/lib/messaging";
import { musicListItem, videoOnlyListItem, videoQueueItem } from "@/lib/storage";
import { playlistMetadataSignal, videoDataStore } from "@/lib/synced-stores.svelte";
import { resolveVideoFilename } from "@/lib/utils";
import {
  DownloadType,
  PlaylistDownloadMode,
  PlaylistOutputMode,
  type DownloadRequest,
  type Options,
  type VideoData
} from "@/types";
import { SvelteMap, SvelteSet } from "svelte/reactivity";

const CHECKBOX_ATTRIBUTE = "data-ytdl-checkbox";

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
  const checkedVideoIds = new SvelteSet<string>();
  let isDownloading = $state(false);
  let downloadedCount = $state(0);
  let totalCount = $state(0);
  let error = $state("");
  let downloadMode = $state(PlaylistDownloadMode.Fast);
  let outputMode = $state(PlaylistOutputMode.Zip);

  // Sync video data from the synced store as each playlist item reports in
  $effect(() => {
    for (const videoId of videoDataStore.keys()) {
      const data = videoDataStore.get(videoId);
      if (data && !videoDataMap.has(videoId)) {
        videoDataMap.set(videoId, data);
      }
    }
  });

  // Track checkboxes for per-video selection
  function handleCheckboxChange(e: Event) {
    if (!(e.target instanceof HTMLInputElement) || !e.target.matches(`[${CHECKBOX_ATTRIBUTE}]`)) {
      return;
    }

    const videoId = e.target.dataset.videoId ?? "";
    if (!videoId) {
      return;
    }

    if (e.target.checked) {
      checkedVideoIds.add(videoId);
    } else {
      checkedVideoIds.delete(videoId);
    }
  }

  $effect(() => {
    document.addEventListener("change", handleCheckboxChange);
    return () => document.removeEventListener("change", handleCheckboxChange);
  });

  const downloadableVideos = $derived([...videoDataMap.values()].filter(data => data.isDownloadable));
  const nonDownloadableCount = $derived(videoDataMap.size - downloadableVideos.length);

  const checkedDownloadableVideos = $derived(
    checkedVideoIds.size === 0
      ? downloadableVideos
      : downloadableVideos.filter(data => checkedVideoIds.has(data.videoId))
  );

  const downloadButtonLabel = $derived.by(() => {
    if (isDownloading) {
      return `Downloading ${downloadedCount}/${totalCount}`;
    }

    const count = checkedDownloadableVideos.length;
    if (count === 0) {
      return "No downloadable videos";
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

  async function startDownload() {
    if (checkedDownloadableVideos.length === 0) {
      return;
    }

    error = "";
    isDownloading = true;
    totalCount = checkedDownloadableVideos.length;
    downloadedCount = 0;

    const metadata = playlistMetadataSignal.value;
    const playlistTitle = metadata?.playlistTitle || "Playlist";
    const playlistId = metadata?.playlistId || `playlist-${Date.now()}`;
    const isZipBundle = outputMode === PlaylistOutputMode.Zip;

    const downloadRequests = checkedDownloadableVideos.map(data =>
      buildDownloadRequest(
        data, getOptions(), playlistId, playlistTitle, checkedDownloadableVideos.length, isZipBundle
      ));

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
    const videoIds = checkedDownloadableVideos.map(data => data.videoId);
    await sendMessage(MessageType.CancelDownload, { videoIds });
    isDownloading = false;
    downloadedCount = 0;
  }

  function toggleDownload() {
    if (isDownloading) {
      void cancelDownload();
    } else {
      void startDownload();
    }
  }

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
    get checkedDownloadableVideos() {
      return checkedDownloadableVideos;
    },
    get downloadButtonLabel() {
      return downloadButtonLabel;
    },
    get videoDataMapSize() {
      return videoDataMap.size;
    },
    toggleDownload
  };
}
