import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";
import { statusProgressItem, videoQueueItem } from "@/lib/storage/storage";
import { contentOptions, downloadProgressStore } from "@/lib/ui/synced-stores.svelte";
import { getCompatibleFilename, getOutputExtension, resolveAutoExtension } from "@/lib/utils/containers";
import {
  calculateWeightedProgress,
  formatAudioCodecLabel,
  formatVideoQualityLabel,
  waitForVideoElement
} from "@/lib/youtube/video-helpers";
import {
  DownloadType,
  ProgressType,
  VideoQualityMode,
  type AdaptiveFormatItem,
  type VideoData
} from "@/types";
import { untrack } from "svelte";

// Prefer M4A (AAC) over WebM/Opus for music because M4A supports MJPEG cover art embedding.
function getPreferredMusicAudioFormat(audioFormats: AdaptiveFormatItem[]) {
  return audioFormats.find(format => /mp4/.test(format.mimeType)) ?? audioFormats[0] ?? null;
}

export function createPanelState(getVideoData: () => VideoData) {
  let isDownloading = $state(false);
  let isDone = $state(false);
  let progress = $state(0);
  let progressType = $state<ProgressType | "">("");

  let downloadType = $state<DownloadType>(
    untrack(() => {
      const options = contentOptions.value;
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
  let filename = $state(untrack(() => getCompatibleFilename(getVideoData().title)));
  let extension = $state(
    untrack(() => {
      const videoData = getVideoData();
      const options = contentOptions.value;
      const extPref = videoData.isMusic ? options.ext.audio : options.ext.video;
      const defaultFormat = videoData.isMusic
        ? getPreferredMusicAudioFormat(videoData.audioFormats)
        : videoData.videoFormats[0];
      return resolveAutoExtension(extPref, defaultFormat?.mimeType ?? "", videoData.isMusic ? DownloadType.Audio : DownloadType.Video);
    })
  );
  let isFilenameValid = $state(true);

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

  $effect(() => {
    void crossWorldMessenger.sendMessage(CrossWorldMessage.FilenameChanged, {
      filename: fullFilename,
      quality: qualityLabel,
      videoItag: selectedVideoFormat?.itag,
      audioItag: selectedAudioFormat?.itag
    });
  });

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
    const options = contentOptions.value;
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

  function applyDownloadState(state: Parameters<typeof downloadProgressStore.set>[1]) {
    isDownloading = state.isDownloading;
    isDone = state.isDone;
    progress = state.progress;
    progressType = state.progressType;
  }

  $effect(() => {
    const { videoId } = getVideoData();

    async function restoreProgress() {
      const currentProgress = await statusProgressItem.getValue();
      const existing = currentProgress[videoId];
      if (!existing) {
        return;
      }

      applyDownloadState({
        progress: existing.progress,
        progressType: existing.progressType,
        isDownloading: existing.progress > 0 && existing.progress < 1,
        isDone: existing.progress >= 1
      });
    }

    void restoreProgress();
  });

  $effect(() => {
    const { videoId } = getVideoData();
    applyDownloadState(
      downloadProgressStore.get(videoId) ?? {
        isDownloading: false,
        isDone: false,
        progress: 0,
        progressType: ""
      }
    );
  });

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

  function handleDownloadTypeChange(newType: DownloadType) {
    const options = contentOptions.value;
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
    void crossWorldMessenger.sendMessage(CrossWorldMessage.CancelRequest, { videoIds: [videoId] });
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
