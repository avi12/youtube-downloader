import { PANEL_OPTIONS } from "./DownloadOptions.state.svelte";
import { createDownloadStoreState } from "./DownloadOptionsPanel.download-state.svelte";
import { createTrackStates } from "./DownloadOptionsPanel.tracks.svelte";
import { AUTO_DUB_TRACK_SUFFIX } from "./helpers/audio-language-helpers";
import {
  applyDownloadTypeChange,
  sendCancelDownload,
  sendDiscardInterrupted,
  sendRevealDownload,
  sendStartDownload
} from "./helpers/panel-download-actions";
import {
  IS_WATCH_PAGE,
  resolveInitialAudioFormat,
  resolveInitialDownloadType,
  resolveInitialExtension,
  resolveInitialFilename
} from "./helpers/panel-init";
import { resolveActualExtension, resolvePrimaryState, resolveQualityLabel } from "./helpers/panel-state-derived";
import { syncAudioFromFormat } from "./helpers/player-active-tracks.svelte";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";
import {
  CONTENT_OPTIONS,
  downloadProgressStore,
  interruptedDownloadStore,
  statusProgressSignal
} from "@/lib/ui/synced-stores.svelte";
import { getCompatibleFilename, isAudioMimeNativeForContainer, resolveAutoExtension } from "@/lib/utils/containers";
import {
  alignAudioFormatToExtension,
  calculateWeightedProgress,
  normalizeLanguageCode
} from "@/lib/youtube/video-helpers";
import { DownloadType, type AdaptiveFormatItem, type VideoData } from "@/types";
import { untrack } from "svelte";
import { SvelteMap } from "svelte/reactivity";

const PAGE_LOCALE = document.documentElement.lang || undefined;
const SIZE_FORMATTER_KB = new Intl.NumberFormat(PAGE_LOCALE, {
  style: "unit",
  unit: "kilobyte",
  unitDisplay: "narrow",
  maximumFractionDigits: 0
});
const SIZE_FORMATTER_MB = new Intl.NumberFormat(PAGE_LOCALE, {
  style: "unit",
  unit: "megabyte",
  unitDisplay: "narrow",
  maximumFractionDigits: 1
});
const SIZE_FORMATTER_GB = new Intl.NumberFormat(PAGE_LOCALE, {
  style: "unit",
  unit: "gigabyte",
  unitDisplay: "narrow",
  maximumFractionDigits: 2
});
const CAPTION_BYTES_PER_SECOND = 10;
const MILLISECONDS_PER_SECOND = 1000;
const BYTES_PER_KILOBYTE = 1024;
const BYTES_PER_MEGABYTE = BYTES_PER_KILOBYTE * 1024;
const BYTES_PER_GIGABYTE = BYTES_PER_MEGABYTE * 1024;
const MEGABYTES_PER_GIGABYTE = 1000;

export function createPanelState(getVideoData: () => VideoData) {
  const store = createDownloadStoreState(getVideoData);

  let downloadId = $state<number | null>(null);
  let downloadType = $state<DownloadType>(
    untrack(() => {
      const entry = downloadProgressStore.get(getVideoData().videoId);
      if (entry?.downloadType && entry.isDownloading) {
        return entry.downloadType;
      }

      return resolveInitialDownloadType({
        options: CONTENT_OPTIONS,
        videoData: getVideoData()
      });
    })
  );
  let selectedVideoFormat = $state<AdaptiveFormatItem | null>(
    untrack(() => {
      const entry = downloadProgressStore.get(getVideoData().videoId);
      if (entry?.videoItag && entry.isDownloading) {
        const matched = getVideoData().videoFormats.find(fmt => fmt.itag === entry.videoItag);
        return matched ?? getVideoData().videoFormats[0] ?? null;
      }

      return getVideoData().videoFormats[0] ?? null;
    })
  );
  const initialAudioFormat = untrack(() => {
    const entry = downloadProgressStore.get(getVideoData().videoId);
    if (entry?.audioItag && entry.isDownloading) {
      return getVideoData().audioFormats.find(fmt => fmt.itag === entry.audioItag) ?? resolveInitialAudioFormat({
        options: CONTENT_OPTIONS,
        videoData: getVideoData()
      });
    }

    return resolveInitialAudioFormat({
      options: CONTENT_OPTIONS,
      videoData: getVideoData()
    });
  });
  untrack(() => syncAudioFromFormat(initialAudioFormat));
  let selectedAudioFormat = $state<AdaptiveFormatItem | null>(initialAudioFormat);
  let filename = $state(untrack(() => resolveInitialFilename(getVideoData())));
  let extension = $state(
    untrack(() => resolveInitialExtension({
      options: CONTENT_OPTIONS,
      videoData: getVideoData()
    }))
  );
  let isFilenameValid = $state(true);

  const actualExtension = $derived(
    resolveActualExtension({
      downloadType,
      selectedVideoFormat,
      selectedAudioFormat,
      extension,
      getVideoData,
      downloadExtras: PANEL_OPTIONS.downloadExtras
    })
  );
  const isDownloadable = $derived(getVideoData().isDownloadable);
  const isInterrupted = $derived(!!interruptedDownloadStore.get(getVideoData().videoId));
  const statusEntry = $derived(statusProgressSignal.value[getVideoData().videoId]);
  const statusIsDownloading = $derived(statusEntry?.isDownloading ?? false);
  const statusIsDone = $derived(statusEntry?.isDone ?? false);
  const primaryState = $derived(
    resolvePrimaryState({
      isDownloading: statusIsDownloading,
      isFailed: store.isFailed,
      isInterrupted,
      isDone: statusIsDone
    })
  );
  const displayProgress = $derived(
    calculateWeightedProgress({
      isDownloading: statusIsDownloading,
      progress: statusEntry?.progress ?? 0,
      progressType: statusEntry?.progressType ?? ""
    })
  );
  const fullFilename = $derived(getCompatibleFilename(`${filename}.${actualExtension}`));
  const qualityLabel = $derived(
    resolveQualityLabel({
      downloadType,
      selectedVideoFormat,
      selectedAudioFormat
    })
  );
  const { audio, caption } = createTrackStates({
    getVideoData,
    setSelectedAudioFormat(value) {
      selectedAudioFormat = value;
    },
    setSelectedVideoFormat(value) {
      selectedVideoFormat = value;
    },
    resetDoneState: store.resetDoneState,
    setDownloadId(value) {
      downloadId = value;
    }
  });

  const estimatedSizeLabel = $derived.by(() => {
    const isAudioOnly = downloadType === DownloadType.Audio;
    const isVideoOnly = downloadType === DownloadType.Video;
    const isVideoAndAudio = downloadType === DownloadType.VideoAndAudio;
    const videoBytes = !isAudioOnly ? parseInt(selectedVideoFormat?.contentLength ?? "0", 10) : 0;

    let audioBytes: number;
    const selectedTrackId = selectedAudioFormat?.audioTrack?.id;
    const isBundleMode = !isVideoOnly && PANEL_OPTIONS.downloadExtras && isVideoAndAudio && !!selectedTrackId;
    const isSelectedAutoDubbed = isBundleMode && selectedTrackId!.endsWith(AUTO_DUB_TRACK_SUFFIX);
    const isAutoDubbedWithBundleBlocked = isSelectedAutoDubbed && !PANEL_OPTIONS.includeAutoDubbing;
    if (isAutoDubbedWithBundleBlocked) {
      audioBytes = parseInt(selectedAudioFormat!.contentLength ?? "0", 10);
    } else if (isBundleMode) {
      const bestByLanguage = new SvelteMap<string, AdaptiveFormatItem>();
      for (const format of getVideoData().audioFormats) {
        const isFormatWithoutTrack = !format.audioTrack;
        if (isFormatWithoutTrack) {
          continue;
        }

        const trackId = format.audioTrack!.id;
        const isSameAsSelected = trackId === selectedTrackId;
        if (isSameAsSelected) {
          continue;
        }

        const isAutoDubbingBlocked = !PANEL_OPTIONS.includeAutoDubbing && trackId.endsWith(AUTO_DUB_TRACK_SUFFIX);
        if (isAutoDubbingBlocked) {
          continue;
        }

        const languageCode = normalizeLanguageCode(trackId);
        const existing = bestByLanguage.get(languageCode);
        const isBetterBitrate = !existing || format.bitrate > existing.bitrate;
        if (isBetterBitrate) {
          bestByLanguage.set(languageCode, format);
        }
      }

      audioBytes = parseInt(selectedAudioFormat!.contentLength ?? "0", 10);
      for (const format of bestByLanguage.values()) {
        audioBytes += parseInt(format.contentLength ?? "0", 10);
      }
    } else {
      audioBytes = !isVideoOnly ? parseInt(selectedAudioFormat?.contentLength ?? "0", 10) : 0;
    }

    const durationSeconds = parseInt(
      selectedAudioFormat?.approxDurationMs ?? selectedVideoFormat?.approxDurationMs ?? "0",
      10
    ) / MILLISECONDS_PER_SECOND;
    let captionTrackCount = 0;
    const isVideoAndAudioWithCaption = isVideoAndAudio && caption.selectedCaptionTrack;
    if (isVideoAndAudioWithCaption) {
      captionTrackCount = PANEL_OPTIONS.downloadExtraCaptions ? getVideoData().captionTracks.length : 1;
    }

    const captionBytes = captionTrackCount * durationSeconds * CAPTION_BYTES_PER_SECOND;

    const totalBytes = videoBytes + audioBytes + captionBytes;
    if (!totalBytes) {
      return "";
    }

    const megabytes = totalBytes / BYTES_PER_MEGABYTE;
    const isLessThanMegabyte = megabytes < 1;
    if (isLessThanMegabyte) {
      return `~${SIZE_FORMATTER_KB.format(totalBytes / BYTES_PER_KILOBYTE)}`;
    }

    const isLessThanGigabyte = megabytes < MEGABYTES_PER_GIGABYTE;
    if (isLessThanGigabyte) {
      return `~${SIZE_FORMATTER_MB.format(megabytes)}`;
    }

    return `~${SIZE_FORMATTER_GB.format(totalBytes / BYTES_PER_GIGABYTE)}`;
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

  $effect(() => {
    const currentAudioFormat = selectedAudioFormat;
    const isAudioDownload = downloadType === DownloadType.Audio;
    if (!isAudioDownload || !currentAudioFormat) {
      return;
    }

    const isCurrentCompatible = isAudioMimeNativeForContainer({
      audioMimeType: currentAudioFormat.mimeType,
      targetExtension: untrack(() => extension)
    });
    if (isCurrentCompatible) {
      return;
    }

    extension = resolveAutoExtension({
      extension: CONTENT_OPTIONS.ext.audio,
      mimeType: currentAudioFormat.mimeType,
      isAudio: true
    });
  });

  function handleDownloadTypeChange(newType: DownloadType) {
    const result = applyDownloadTypeChange({
      newType,
      selectedVideoFormat,
      selectedAudioFormat,
      videoId: getVideoData().videoId
    });
    downloadType = result.downloadType;
    extension = result.extension;
  }

  function startDownload() {
    sendStartDownload({
      downloadType,
      selectedVideoFormat,
      selectedAudioFormat,
      selectedCaptionTrack: caption.selectedCaptionTrack,
      isDownloading: store.isDownloading,
      isDownloadable,
      isFilenameValid,
      fullFilename,
      videoData: getVideoData()
    });
  }

  return {
    get isDownloading() {
      return statusIsDownloading;
    },
    get isDone() {
      return statusIsDone;
    },
    get progress() {
      return statusEntry?.progress ?? 0;
    },
    get progressType() {
      return statusEntry?.progressType ?? "";
    },
    get downloadType() {
      return downloadType;
    },
    get selectedVideoFormat() {
      return selectedVideoFormat;
    },
    set selectedVideoFormat(value: AdaptiveFormatItem | null) {
      selectedVideoFormat = value;
      store.resetDoneState();
    },
    get selectedAudioFormat() {
      return selectedAudioFormat;
    },
    set selectedAudioFormat(value: AdaptiveFormatItem | null) {
      selectedAudioFormat = value;
      store.resetDoneState();
    },
    get filename() {
      return filename;
    },
    set filename(value: string) {
      filename = value;
      store.resetDoneState();
    },
    get extension() {
      return extension;
    },
    set extension(value: string) {
      extension = value;
      const isAudioDownload = downloadType === DownloadType.Audio;
      if (isAudioDownload) {
        const aligned = alignAudioFormatToExtension({
          audioFormats: getVideoData().audioFormats,
          currentFormat: selectedAudioFormat,
          targetExtension: value
        });
        if (aligned && aligned !== selectedAudioFormat) {
          selectedAudioFormat = aligned;
          syncAudioFromFormat(aligned);
        }
      }

      store.resetDoneState();
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
      return store.isFailed;
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
    get estimatedSizeLabel() {
      return estimatedSizeLabel;
    },
    get isFilenameValid() {
      return isFilenameValid;
    },
    set isFilenameValid(value: boolean) {
      isFilenameValid = value;
    },
    get downloadId() {
      return downloadId;
    },
    get isWatchPage() {
      return IS_WATCH_PAGE;
    },
    get downloadExtras() {
      return PANEL_OPTIONS.downloadExtras;
    },
    audio,
    caption,
    handleDownloadTypeChange,
    startDownload,
    cancelDownload: () => sendCancelDownload(getVideoData().videoId),
    resumeDownload: startDownload,
    discardInterrupted: () => sendDiscardInterrupted(getVideoData().videoId),
    revealDownload: () => sendRevealDownload(downloadId)
  };
}
