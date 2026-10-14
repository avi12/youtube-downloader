import { lockPanelOptions, PANEL_OPTIONS, unlockPanelOptions } from "./DownloadOptions.state.svelte";
import { createDownloadStoreState } from "./DownloadOptionsPanel.download-state.svelte";
import { createTrackStates } from "./DownloadOptionsPanel.tracks.svelte";
import {
  applyDownloadTypeChange,
  buildDownloadPlanParams,
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
import { CONTENT_OPTIONS, interruptedDownloadStore, statusProgressSignal } from "@/lib/ui/synced-stores.svelte";
import { getCompatibleFilename, isAudioMimeNativeForContainer, resolveAutoExtension } from "@/lib/utils/containers";
import { pinAudioCodecPreferences, pinVideoCodecPreferences } from "@/lib/youtube/align-formats-to-container";
import { resolveDownloadPlan } from "@/lib/youtube/download-plan";
import { predictOutputSize, type SizeInputs } from "@/lib/youtube/output-size";
import { selectVideoFormatForQuality } from "@/lib/youtube/select-video-quality";
import { alignAudioFormatToExtension, calculateWeightedProgress } from "@/lib/youtube/video-helpers";
import { DownloadType, type AdaptiveFormatItem, type CodecPreferences, type VideoData } from "@/types";
import { untrack } from "svelte";

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
  maximumFractionDigits: 2
});
const SIZE_FORMATTER_GB = new Intl.NumberFormat(PAGE_LOCALE, {
  style: "unit",
  unit: "gigabyte",
  unitDisplay: "narrow",
  maximumFractionDigits: 2
});
const APPROXIMATE_PREFIX = "~";
const BYTES_PER_KILOBYTE = 1024;
const BYTES_PER_MEGABYTE = BYTES_PER_KILOBYTE * 1024;
const BYTES_PER_GIGABYTE = BYTES_PER_MEGABYTE * 1024;

export function createPanelState(getVideoData: () => VideoData) {
  const store = createDownloadStoreState(getVideoData);

  let downloadId = $state<number | null>(null);
  let downloadType = $state<DownloadType>(
    untrack(() => {
      const entry = statusProgressSignal.value[getVideoData().videoId];
      if (entry?.downloadType && entry.isDownloading) {
        return entry.downloadType;
      }

      return resolveInitialDownloadType({
        options: CONTENT_OPTIONS,
        videoData: getVideoData()
      });
    })
  );
  let extension = $state(
    untrack(() => resolveInitialExtension({
      options: CONTENT_OPTIONS,
      videoData: getVideoData(),
      downloadType
    }))
  );
  let selectedVideoFormat = $state<AdaptiveFormatItem | null>(
    untrack(() => {
      const entry = statusProgressSignal.value[getVideoData().videoId];
      const qualityFormat = selectVideoFormatForQuality({
        videoData: getVideoData(),
        options: CONTENT_OPTIONS,
        targetExtension: extension
      });
      if (entry?.videoItag && entry.isDownloading) {
        return getVideoData().videoFormats.find(format => format.itag === entry.videoItag) ?? qualityFormat;
      }

      return qualityFormat;
    })
  );
  const initialAudioFormat = untrack(() => {
    const entry = statusProgressSignal.value[getVideoData().videoId];
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
  // A format picked by hand pins its codec for this download only, so the plan keeps it;
  // until then the settings rule
  let pinnedVideoFormat = $state<AdaptiveFormatItem | null>(null);
  let pinnedAudioFormat = $state<AdaptiveFormatItem | null>(null);
  const codecPreferences: CodecPreferences = $derived.by(() => {
    const settingsPreferences = {
      videoCodec: CONTENT_OPTIONS.videoCodec,
      audioCodec: CONTENT_OPTIONS.audioCodec,
      dynamicRange: CONTENT_OPTIONS.dynamicRange
    };
    const videoPinned = pinnedVideoFormat
      ? pinVideoCodecPreferences({
        codecPreferences: settingsPreferences,
        videoFormat: pinnedVideoFormat
      })
      : settingsPreferences;
    return pinnedAudioFormat
      ? pinAudioCodecPreferences({
        codecPreferences: videoPinned,
        audioFormat: pinnedAudioFormat
      })
      : videoPinned;
  });
  let isFilenameValid = $state(true);

  const actualExtension = $derived(
    resolveActualExtension({
      downloadType,
      selectedVideoFormat,
      selectedAudioFormat,
      extension,
      getVideoData,
      downloadExtras: PANEL_OPTIONS.downloadExtras,
      codecPreferences
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
    setDownloadId(value) {
      downloadId = value;
    },
    isDownloading: () => statusIsDownloading,
    getExtension: () => extension
  });

  const planParams = $derived(
    buildDownloadPlanParams({
      downloadType,
      selectedVideoFormat,
      selectedAudioFormat,
      selectedCaptionTrack: caption.selectedCaptionTrack,
      codecPreferences
    })
  );
  let sizeInputs = $state<SizeInputs | null>(null);
  $effect(() => {
    const request = {
      videoId: getVideoData().videoId,
      params: $state.snapshot(planParams)
    };
    let isCurrentRequest = true;
    sizeInputs = null;
    crossWorldMessenger.sendMessage(CrossWorldMessage.MeasureSizeInputs, request)
      .then(inputs => {
        if (isCurrentRequest) {
          sizeInputs = inputs;
        }
      })
      .catch(() => {});
    return () => {
      isCurrentRequest = false;
    };
  });

  const estimatedSizeLabel = $derived.by(() => {
    const plan = resolveDownloadPlan({
      videoData: getVideoData(),
      params: planParams,
      targetExtension: actualExtension
    });
    const size = predictOutputSize({
      type: downloadType,
      extension: actualExtension,
      videoFormat: plan.videoFormat,
      audioFormat: plan.audioFormat,
      extraAudioFormats: plan.extraAudioFormats,
      inputs: sizeInputs
    });
    if (!size?.bytes) {
      return "";
    }

    const prefix = size.isApproximate ? APPROXIMATE_PREFIX : "";
    const megabytes = size.bytes / BYTES_PER_MEGABYTE;
    const isLessThanMegabyte = megabytes < 1;
    if (isLessThanMegabyte) {
      return `${prefix}${SIZE_FORMATTER_KB.format(size.bytes / BYTES_PER_KILOBYTE)}`;
    }

    const isLessThanGigabyte = size.bytes < BYTES_PER_GIGABYTE;
    if (isLessThanGigabyte) {
      return `${prefix}${SIZE_FORMATTER_MB.format(megabytes)}`;
    }

    return `${prefix}${SIZE_FORMATTER_GB.format(size.bytes / BYTES_PER_GIGABYTE)}`;
  });

  $effect(() => {
    void crossWorldMessenger.sendMessage(CrossWorldMessage.FilenameChanged, {
      filename: fullFilename,
      quality: qualityLabel,
      videoItag: selectedVideoFormat?.itag,
      audioItag: selectedAudioFormat?.itag,
      audioTrackId: selectedAudioFormat?.audioTrack?.id,
      codecPreferences: $state.snapshot(codecPreferences)
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

  function applyExtension(value: string) {
    extension = value;
    const isAudioDownload = downloadType === DownloadType.Audio;
    if (!isAudioDownload) {
      return;
    }

    const aligned = alignAudioFormatToExtension({
      audioFormats: getVideoData().audioFormats,
      currentFormat: selectedAudioFormat,
      targetExtension: value,
      codecPreferences
    });
    if (aligned && aligned !== selectedAudioFormat) {
      selectedAudioFormat = aligned;
      syncAudioFromFormat(aligned);
    }
  }

  let previousDefaultDownloadType = untrack(() => CONTENT_OPTIONS.defaultDownloadType);
  $effect(() => {
    const { defaultDownloadType } = CONTENT_OPTIONS;
    const isUnchanged = defaultDownloadType === previousDefaultDownloadType;
    previousDefaultDownloadType = defaultDownloadType;

    if (isUnchanged) {
      return;
    }

    untrack(() => {
      if (statusIsDownloading) {
        return;
      }

      handleDownloadTypeChange(
        resolveInitialDownloadType({
          options: CONTENT_OPTIONS,
          videoData: getVideoData()
        })
      );
    });
  });

  let previousExtensionPreference = untrack(() => ({ ...CONTENT_OPTIONS.ext }));
  $effect(() => {
    const { video, audio } = CONTENT_OPTIONS.ext;
    const previous = previousExtensionPreference;
    previousExtensionPreference = {
      video,
      audio
    };

    untrack(() => {
      const isAudioDownload = downloadType === DownloadType.Audio;
      const isRelevantChange = isAudioDownload ? audio !== previous.audio : video !== previous.video;
      if (!isRelevantChange || statusIsDownloading) {
        return;
      }

      const result = applyDownloadTypeChange({
        newType: downloadType,
        selectedVideoFormat,
        selectedAudioFormat
      });
      applyExtension(result.extension);
    });
  });

  // Changing a codec setting in the popup reaches open panels too: it replaces the codec picked
  // here by hand, as the format setting above replaces the picked format
  let previousCodecSettings = untrack(() => ({
    videoCodec: CONTENT_OPTIONS.videoCodec,
    audioCodec: CONTENT_OPTIONS.audioCodec,
    dynamicRange: CONTENT_OPTIONS.dynamicRange
  }));
  $effect(() => {
    const { videoCodec, audioCodec, dynamicRange } = CONTENT_OPTIONS;
    const previous = previousCodecSettings;
    previousCodecSettings = {
      videoCodec,
      audioCodec,
      dynamicRange
    };

    untrack(() => {
      if (statusIsDownloading) {
        return;
      }

      const isVideoSettingChanged = videoCodec !== previous.videoCodec || dynamicRange !== previous.dynamicRange;
      if (isVideoSettingChanged) {
        pinnedVideoFormat = null;
      }

      const isAudioSettingChanged = audioCodec !== previous.audioCodec;
      if (isAudioSettingChanged) {
        pinnedAudioFormat = null;
        // Audio-only picks follow the audio container, so re-match the pick to it under the new codec
        applyExtension(extension);
      }
    });
  });

  function handleDownloadTypeChange(newType: DownloadType) {
    const result = applyDownloadTypeChange({
      newType,
      selectedVideoFormat,
      selectedAudioFormat
    });
    downloadType = result.downloadType;
    applyExtension(result.extension);
  }

  function startDownload() {
    lockPanelOptions();
    sendStartDownload({
      downloadType,
      selectedVideoFormat,
      selectedAudioFormat,
      selectedCaptionTrack: caption.selectedCaptionTrack,
      codecPreferences,
      isDownloading: store.isDownloading,
      isDownloadable,
      isFilenameValid,
      fullFilename,
      videoData: getVideoData()
    });
  }

  $effect(() => {
    const isComplete = statusIsDone || store.isFailed;
    if (!isComplete) {
      return;
    }

    unlockPanelOptions();
  });

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
      pinnedVideoFormat = value;
    },
    get selectedAudioFormat() {
      return selectedAudioFormat;
    },
    set selectedAudioFormat(value: AdaptiveFormatItem | null) {
      selectedAudioFormat = value;
      pinnedAudioFormat = value;
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
      applyExtension(value);
    },
    get actualExtension() {
      return actualExtension;
    },
    get codecPreferences() {
      return codecPreferences;
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
