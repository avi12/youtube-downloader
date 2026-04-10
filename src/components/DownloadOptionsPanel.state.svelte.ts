import { CrossWorldMessage, crossWorldMessenger } from "@/lib/cross-world-messenger";
import { statusProgressItem, videoQueueItem } from "@/lib/storage";
import { cancelRequestSignal, downloadProgressStore } from "@/lib/synced-stores.svelte";
import {
  calculateWeightedProgress,
  formatAudioCodecLabel,
  formatVideoQualityLabel,
  getCompatibleFilename,
  getOutputExtension,
  resolveAutoExtension,
  waitForVideoElement
} from "@/lib/utils";
import {
  DownloadType,
  ProgressType,
  VideoQualityMode,
  type AdaptiveFormatItem,
  type Options,
  type VideoData
} from "@/types";
import { untrack } from "svelte";

// For music downloads, prefer M4A (AAC) over WebM/Opus — M4A supports MJPEG cover art embedding.
// Formats are already sorted by bitrate descending, so find() returns the highest-quality M4A.
function getPreferredMusicAudioFormat(audioFormats: AdaptiveFormatItem[]) {
  return audioFormats.find(format => format.mimeType.includes("mp4")) ?? audioFormats[0] ?? null;
}

export function createPanelState(getVideoData: () => VideoData, getOptions: () => Options) {
  // -- Download state ----------------------------------------------------------

  let isDownloading = $state(false);
  let isDone = $state(false);
  let progress = $state(0);
  let progressType = $state<ProgressType | "">("");

  // -- Format selection --------------------------------------------------------

  let downloadType = $state<DownloadType>(
    untrack(() => {
      const options = getOptions();
      const videoData = getVideoData();
      if (options.defaultDownloadType !== "auto") {
        return options.defaultDownloadType;
      }

      return videoData.isMusic ? DownloadType.Audio : DownloadType.VideoAndAudio;
    })
  );

  let selectedVideoFormat = $state<AdaptiveFormatItem | null>(untrack(() => getVideoData().videoFormats[0] ?? null));
  let selectedAudioFormat = $state<AdaptiveFormatItem | null>(
    untrack(() => {
      const videoData = getVideoData();
      return videoData.isMusic
        ? getPreferredMusicAudioFormat(videoData.audioFormats)
        : videoData.audioFormats[0] ?? null;
    })
  );
  let filename = $state(untrack(() => getVideoData().title));
  let extension = $state(
    untrack(() => {
      const videoData = getVideoData();
      const options = getOptions();
      const extPref = videoData.isMusic ? options.ext.audio : options.ext.video;
      const defaultFormat = videoData.isMusic
        ? getPreferredMusicAudioFormat(videoData.audioFormats)
        : videoData.videoFormats[0];
      return resolveAutoExtension(extPref, defaultFormat?.mimeType ?? "", videoData.isMusic ? DownloadType.Audio : DownloadType.Video);
    })
  );
  let isFilenameValid = $state(true);

  // -- Derived -----------------------------------------------------------------

  const actualExtension = $derived.by(() => {
    if (downloadType === DownloadType.Audio) {
      return extension;
    }

    if (!selectedVideoFormat || !selectedAudioFormat) {
      return extension;
    }

    return getOutputExtension(selectedVideoFormat.mimeType, selectedAudioFormat.mimeType, extension);
  });

  const isDownloadable = $derived(getVideoData().isDownloadable);
  const displayProgress = $derived(calculateWeightedProgress(isDownloading, progress, progressType));
  const fullFilename = $derived(getCompatibleFilename(`${filename}.${actualExtension}`));

  const qualityLabel = $derived.by(() => {
    if (downloadType === DownloadType.Audio) {
      return selectedAudioFormat
        ? `${Math.floor(selectedAudioFormat.bitrate / 1000)} kbps (${formatAudioCodecLabel(selectedAudioFormat.mimeType)})`
        : "";
    }

    return selectedVideoFormat ? formatVideoQualityLabel(selectedVideoFormat) : "";
  });

  // Notify the MAIN world download button tooltip when filename or quality changes
  $effect(() => {
    void crossWorldMessenger.sendMessage(CrossWorldMessage.FilenameChanged, {
      filename: fullFilename,
      quality: qualityLabel,
      videoItag: selectedVideoFormat?.itag,
      audioItag: selectedAudioFormat?.itag
    });
  });

  // -- Video quality matching --------------------------------------------------

  async function matchVideoFormatToCurrentQuality(signal: AbortSignal) {
    const videoData = getVideoData();
    try {
      const elVideo = await waitForVideoElement(signal);
      const currentQuality = Math.min(elVideo.videoHeight, elVideo.videoWidth);
      selectedVideoFormat = videoData.videoFormats.find(
        format => Math.min(format.height ?? 0, format.width ?? 0) === currentQuality
      ) ?? videoData.videoFormats[0] ?? null;
    } catch {
      selectedVideoFormat = videoData.videoFormats[0] ?? null;
    }
  }

  $effect(() => {
    const options = getOptions();
    const videoData = getVideoData();
    if (options.videoQualityMode === VideoQualityMode.CurrentQuality) {
      const abortController = new AbortController();
      void matchVideoFormatToCurrentQuality(abortController.signal);
      const elVideo = document.querySelector("video");
      function onCanPlay() {
        void matchVideoFormatToCurrentQuality(abortController.signal);
      }
      elVideo?.addEventListener("canplay", onCanPlay);
      return () => {
        abortController.abort();
        elVideo?.removeEventListener("canplay", onCanPlay);
      };
    }

    if (options.videoQualityMode === VideoQualityMode.Best) {
      selectedVideoFormat = videoData.videoFormats[0] ?? null;
      return;
    }

    selectedVideoFormat =
      videoData.videoFormats.find(format => format.height === options.videoQuality) ??
      videoData.videoFormats[0] ??
      null;
  });

  // -- Restore existing download state on mount --------------------------------

  $effect(() => {
    const { videoId } = getVideoData();

    async function restoreProgress() {
      const currentProgress = await statusProgressItem.getValue();
      const existing = currentProgress[videoId];
      if (!existing) {
        return;
      }

      progress = existing.progress;
      progressType = existing.progressType;
      isDownloading = existing.progress > 0 && existing.progress < 1;
      isDone = existing.progress >= 1;
    }

    void restoreProgress();
  });

  // -- Progress updates -------------------------------------------------------

  $effect(() => {
    const { videoId } = getVideoData();
    const state = downloadProgressStore.get(videoId);
    if (!state) {
      progress = 0;
      progressType = "";
      isDownloading = false;
      isDone = false;
      return;
    }

    isDownloading = state.isDownloading;
    isDone = state.isDone;
    progress = state.progress;
    progressType = state.progressType;
  });

  // -- Queue position tracking ------------------------------------------------

  $effect(() => {
    const { videoId } = getVideoData();
    return videoQueueItem.watch(queue => {
      const currentQueue = queue ?? [];
      if (currentQueue[0]?.videoId !== videoId) {
        return;
      }

      progress = 0;
      progressType = "";
    });
  });

  // -- Actions ----------------------------------------------------------------

  function handleDownloadTypeChange(newType: DownloadType) {
    const options = getOptions();
    isDownloading = false;
    progress = 0;
    downloadType = newType;
    const extPref = newType === DownloadType.Audio ? options.ext.audio : options.ext.video;
    const format = newType === DownloadType.Audio ? selectedAudioFormat : selectedVideoFormat;
    extension = resolveAutoExtension(extPref, format?.mimeType ?? "", newType === DownloadType.Audio ? DownloadType.Audio : DownloadType.Video);
  }

  function startDownload() {
    if (isDownloading || !isDownloadable || !isFilenameValid || !selectedAudioFormat) {
      return;
    }

    if (downloadType !== DownloadType.Audio && !selectedVideoFormat) {
      return;
    }

    const { videoId, sabrConfig } = getVideoData();

    isDownloading = true;
    isDone = false;
    progress = 0;

    if (downloadType === DownloadType.VideoAndAudio) {
      progressType = "";
    }

    downloadProgressStore.unsuppress(videoId);
    downloadProgressStore.set(videoId, {
      isDownloading: true,
      isDone: false,
      progress: 0,
      progressType: ""
    });

    void crossWorldMessenger.sendMessage(CrossWorldMessage.DownloadRequest, {
      type: downloadType,
      videoId,
      videoItag: selectedVideoFormat?.itag ?? 0,
      audioItag: selectedAudioFormat.itag,
      filenameOutput: fullFilename,
      sabrConfig
    });
  }

  async function cancelDownload() {
    const { videoId } = getVideoData();
    isDownloading = false;
    progress = 0;
    downloadProgressStore.delete(videoId);
    cancelRequestSignal.value = { videoIds: [videoId] };
    const currentProgress = await statusProgressItem.getValue();
    delete currentProgress[videoId];
    await statusProgressItem.setValue(currentProgress);
  }

  return {
    get isDownloading() {
      return isDownloading;
    },
    get isDone() {
      return isDone;
    },
    get progress() {
      return progress;
    },
    get progressType() {
      return progressType;
    },
    get downloadType() {
      return downloadType;
    },
    get selectedVideoFormat() {
      return selectedVideoFormat;
    },
    get selectedAudioFormat() {
      return selectedAudioFormat;
    },
    get filename() {
      return filename;
    },
    set filename(value: string) {
      filename = value;
    },
    get extension() {
      return extension;
    },
    set extension(value: string) {
      extension = value;
    },
    get actualExtension() {
      return actualExtension;
    },
    get isDownloadable() {
      return isDownloadable;
    },
    get displayProgress() {
      return displayProgress;
    },
    get fullFilename() {
      return fullFilename;
    },
    get qualityLabel() {
      return qualityLabel;
    },
    get isFilenameValid() {
      return isFilenameValid;
    },
    set isFilenameValid(value: boolean) {
      isFilenameValid = value;
    },
    set selectedVideoFormat(value: AdaptiveFormatItem | null) {
      selectedVideoFormat = value;
    },
    set selectedAudioFormat(value: AdaptiveFormatItem | null) {
      selectedAudioFormat = value;
    },
    handleDownloadTypeChange,
    startDownload,
    cancelDownload
  };
}
