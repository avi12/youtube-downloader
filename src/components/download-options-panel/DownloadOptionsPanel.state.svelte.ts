import { cancelStreamTransfer } from "@/entrypoints/youtube.content/download/stream-transfer";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";
import { MessageType, sendMessage } from "@/lib/messaging/messaging";
import { statusProgressItem, videoQueueItem } from "@/lib/storage/storage";
import { completedDownloadsStore } from "@/lib/ui/completed-downloads-store.svelte";
import { PrimaryButtonState } from "@/lib/ui/panel-button-attachments.svelte";
import { CONTENT_OPTIONS, downloadProgressStore, interruptedDownloadStore } from "@/lib/ui/synced-stores.svelte";
import { getCompatibleFilename, getOutputExtension, resolveAutoExtension } from "@/lib/utils/containers";
import {
  calculateWeightedProgress,
  formatAudioCodecLabel,
  formatVideoQualityLabel,
  selectPreferredAudioFormat,
  waitForVideoElement
} from "@/lib/youtube/video-helpers";
import { DownloadType, VideoQualityMode, type AdaptiveFormatItem, type VideoData } from "@/types";
import { untrack } from "svelte";

// Prefer M4A (AAC) over WebM/Opus for music because M4A supports MJPEG cover art embedding.
function getPreferredMusicAudioFormat(audioFormats: AdaptiveFormatItem[]) {
  return audioFormats.find(format => format.mimeType.includes("mp4")) ?? audioFormats[0] ?? null;
}

export function createPanelState(getVideoData: () => VideoData) {
  // Download/progress state is derived directly from the shared store so the
  // panel is always in sync with the watch button and background without a
  // local mirror that can drift.
  const storeEntry = $derived(downloadProgressStore.get(getVideoData().videoId));
  const isDownloading = $derived(storeEntry?.isDownloading ?? false);
  const isDone = $derived(storeEntry?.isDone ?? false);
  const progress = $derived(storeEntry?.progress ?? 0);
  const progressType = $derived(storeEntry?.progressType ?? "");

  let downloadId = $state<number | null>(null);

  let downloadType = $state<DownloadType>(
    untrack(() => {
      const options = CONTENT_OPTIONS.value;
      const videoData = getVideoData();
      if (options.defaultDownloadType !== DownloadType.Auto) {
        return options.defaultDownloadType;
      }

      return videoData.isMusic ? DownloadType.Audio : DownloadType.VideoAndAudio;
    })
  );

  let selectedVideoFormat = $state<AdaptiveFormatItem | null>(untrack(() => getVideoData().videoFormats[0] ?? null));
  let selectedAudioFormat = $state<AdaptiveFormatItem | null>(
    untrack(() => {
      const videoData = getVideoData();
      if (videoData.isMusic) {
        return getPreferredMusicAudioFormat(videoData.audioFormats);
      }

      const options = CONTENT_OPTIONS.value;
      return selectPreferredAudioFormat({
        audioFormats: videoData.audioFormats,
        videoMimeType: videoData.videoFormats[0]?.mimeType ?? "",
        languageMode: options.audioTrackLanguageMode,
        locale: document.documentElement.lang,
        browserLanguage: navigator.language
      });
    })
  );
  let filename = $state(untrack(() => getCompatibleFilename(getVideoData().title || getVideoData().videoId)));
  let extension = $state(
    untrack(() => {
      const videoData = getVideoData();
      const options = CONTENT_OPTIONS.value;
      const extensionPreference = videoData.isMusic ? options.ext.audio : options.ext.video;
      const defaultFormat = videoData.isMusic
        ? getPreferredMusicAudioFormat(videoData.audioFormats)
        : videoData.videoFormats[0];
      return resolveAutoExtension({
        extension: extensionPreference,
        mimeType: defaultFormat?.mimeType ?? ""
      });
    })
  );
  let isFilenameValid = $state(true);

  const actualExtension = $derived.by(() => {
    if (downloadType === DownloadType.Audio) {
      return extension;
    }

    const isMissingFormats = !selectedVideoFormat || !selectedAudioFormat;
    if (isMissingFormats) {
      return extension;
    }

    const baseExtension = getOutputExtension({
      videoMimeType: selectedVideoFormat!.mimeType,
      audioMimeType: selectedAudioFormat!.mimeType,
      userExtension: extension
    });

    const selectedTrackId = selectedAudioFormat!.audioTrack?.id;
    if (selectedTrackId) {
      const hasExtraAudioTracks = getVideoData().audioFormats.some(
        format => format.audioTrack?.id && format.audioTrack.id !== selectedTrackId
      );
      if (hasExtraAudioTracks) {
        return "mkv";
      }
    }

    return baseExtension;
  });

  const isDownloadable = $derived(getVideoData().isDownloadable);
  const isInterrupted = $derived(!!interruptedDownloadStore.get(getVideoData().videoId));
  const isFailed = $derived(storeEntry?.isFailed === true);
  const primaryState = $derived.by<PrimaryButtonState>(() => {
    if (isDownloading) {
      return PrimaryButtonState.Downloading;
    }

    if (isFailed) {
      return PrimaryButtonState.Failed;
    }

    if (isInterrupted) {
      return PrimaryButtonState.Interrupted;
    }

    if (isDone) {
      return PrimaryButtonState.Done;
    }

    return PrimaryButtonState.Idle;
  });
  const displayProgress = $derived(
    calculateWeightedProgress({
      isDownloading,
      progress,
      progressType
    })
  );
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
      audioItag: selectedAudioFormat?.itag,
      audioTrackId: selectedAudioFormat?.audioTrack?.id
    });
  });

  async function matchVideoFormatToCurrentQuality(signal: AbortSignal) {
    const videoData = getVideoData();
    try {
      const elVideo = await waitForVideoElement(signal);
      if (document.getElementById("movie_player")?.classList.contains("ytp-ad-playing")) {
        selectedVideoFormat = videoData.videoFormats[0] ?? null;
        return;
      }

      const currentQuality = Math.min(elVideo.videoHeight, elVideo.videoWidth);
      selectedVideoFormat =
        videoData.videoFormats.find(format => Math.min(format.height ?? 0, format.width ?? 0) === currentQuality)
        ?? videoData.videoFormats[0]
        ?? null;
    } catch {
      selectedVideoFormat = videoData.videoFormats[0] ?? null;
    }
  }

  $effect(() => {
    const options = CONTENT_OPTIONS.value;
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

  $effect(() => {
    const { videoId } = getVideoData();
    const existing = completedDownloadsStore.get(videoId);
    if (existing) {
      downloadId = existing.downloadId;
    }

    return completedDownloadsStore.subscribe((completedVideoId, completed) => {
      if (completedVideoId !== videoId) {
        return;
      }

      downloadId = completed.downloadId;
    });
  });

  // When a queued download (re)starts for this video, reset its progress
  // display locally so the panel shows 0% rather than stale prior progress.
  $effect(() => {
    const { videoId } = getVideoData();
    return videoQueueItem.watch(queue => {
      const currentQueue = queue ?? [];
      if (currentQueue[0]?.videoId !== videoId) {
        return;
      }

      downloadProgressStore.setLocal(videoId, {
        isDownloading: true,
        isDone: false,
        progress: 0,
        progressType: ""
      });
    });
  });

  function resetDoneState() {
    const { videoId } = getVideoData();
    const entry = storeEntry;
    if (!entry?.isDone) {
      return;
    }

    downloadProgressStore.setLocal(videoId, {
      ...entry,
      isDone: false
    });
  }

  function handleDownloadTypeChange(newType: DownloadType) {
    const options = CONTENT_OPTIONS.value;
    const { videoId } = getVideoData();
    // Clear progress display locally when the user picks a different type
    // so the panel shows idle rather than carrying over a stale done/in-progress state.
    downloadProgressStore.setLocal(videoId, {
      isDownloading: false,
      isDone: false,
      progress: 0,
      progressType: ""
    });
    downloadType = newType;
    const extensionPreference = newType === DownloadType.Audio ? options.ext.audio : options.ext.video;
    const format = newType === DownloadType.Audio ? selectedAudioFormat : selectedVideoFormat;
    extension = resolveAutoExtension({
      extension: extensionPreference,
      mimeType: format?.mimeType ?? ""
    });
  }

  function startDownload() {
    const cannotStartDownload = isDownloading || !isDownloadable || !isFilenameValid || !selectedAudioFormat;
    if (cannotStartDownload) {
      return;
    }

    if (downloadType !== DownloadType.Audio && !selectedVideoFormat) {
      return;
    }

    const { videoId, sabrConfig } = getVideoData();
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
      audioItag: selectedAudioFormat!.itag,
      audioTrackId: selectedAudioFormat!.audioTrack?.id,
      filenameOutput: fullFilename,
      sabrConfig
    });
  }

  async function cancelDownload() {
    const { videoId } = getVideoData();
    downloadProgressStore.delete(videoId);
    cancelStreamTransfer(videoId);
    void sendMessage(MessageType.CancelDownload, { videoIds: [videoId] });
    void crossWorldMessenger.sendMessage(CrossWorldMessage.CancelDownload, { videoIds: [videoId] });
    const currentProgress = await statusProgressItem.getValue();
    delete currentProgress[videoId];
    await statusProgressItem.setValue(currentProgress);
  }

  function resumeDownload() {
    startDownload();
  }

  async function discardInterrupted() {
    const { videoId } = getVideoData();
    interruptedDownloadStore.delete(videoId);
    downloadProgressStore.delete(videoId);
    await sendMessage(MessageType.ClearInterruptedDownload, { videoId });
  }

  function revealDownload() {
    if (downloadId === null) {
      return;
    }

    void sendMessage(MessageType.RevealDownloadFile, { downloadId });
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
      resetDoneState();
    },
    get extension() {
      return extension;
    },
    set extension(value: string) {
      extension = value;
      resetDoneState();
    },
    get actualExtension() {
      return actualExtension;
    },
    get isDownloadable() {
      return isDownloadable;
    },
    get isInterrupted() {
      return isInterrupted;
    },
    get isFailed() {
      return isFailed;
    },
    get primaryState() {
      return primaryState;
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
      resetDoneState();
    },
    set selectedAudioFormat(value: AdaptiveFormatItem | null) {
      selectedAudioFormat = value;
      resetDoneState();
    },
    get downloadId() {
      return downloadId;
    },
    handleDownloadTypeChange,
    startDownload,
    cancelDownload,
    resumeDownload,
    discardInterrupted,
    revealDownload
  };
}
