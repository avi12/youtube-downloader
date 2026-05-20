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
import { CONTENT_OPTIONS, interruptedDownloadStore } from "@/lib/ui/synced-stores.svelte";
import { getCompatibleFilename } from "@/lib/utils/containers";
import { calculateWeightedProgress, normalizeLanguageCode } from "@/lib/youtube/video-helpers";
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

export function createPanelState(getVideoData: () => VideoData) {
  const store = createDownloadStoreState(getVideoData);

  let downloadId = $state<number | null>(null);
  let downloadType = $state<DownloadType>(
    untrack(() => resolveInitialDownloadType({
      options: CONTENT_OPTIONS,
      videoData: getVideoData()
    }))
  );
  let selectedVideoFormat = $state<AdaptiveFormatItem | null>(
    untrack(() => getVideoData().videoFormats[0] ?? null)
  );
  const initialAudioFormat = untrack(() => resolveInitialAudioFormat({
    options: CONTENT_OPTIONS,
    videoData: getVideoData()
  }));
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
  const primaryState = $derived(
    resolvePrimaryState({
      isDownloading: store.isDownloading,
      isFailed: store.isFailed,
      isInterrupted,
      isDone: store.isDone
    })
  );
  const displayProgress = $derived(
    calculateWeightedProgress({
      isDownloading: store.isDownloading,
      progress: store.progress,
      progressType: store.progressType
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
    if (isBundleMode && selectedTrackId!.endsWith(AUTO_DUB_TRACK_SUFFIX) && !PANEL_OPTIONS.includeAutoDubbing) {
      audioBytes = parseInt(selectedAudioFormat!.contentLength ?? "0", 10);
    } else if (isBundleMode) {
      const bestByLanguage = new SvelteMap<string, AdaptiveFormatItem>();
      for (const format of getVideoData().audioFormats) {
        if (!format.audioTrack) {
          continue;
        }

        const trackId = format.audioTrack.id;
        if (trackId === selectedTrackId) {
          continue;
        }

        if (!PANEL_OPTIONS.includeAutoDubbing && trackId.endsWith(AUTO_DUB_TRACK_SUFFIX)) {
          continue;
        }

        const languageCode = normalizeLanguageCode(trackId);
        const existing = bestByLanguage.get(languageCode);
        if (!existing || format.bitrate > existing.bitrate) {
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
    ) / 1000;
    let captionTrackCount = 0;
    if (isVideoAndAudio && caption.selectedCaptionTrack) {
      captionTrackCount = PANEL_OPTIONS.downloadExtraCaptions ? getVideoData().captionTracks.length : 1;
    }

    const captionBytes = captionTrackCount * durationSeconds * CAPTION_BYTES_PER_SECOND;

    const totalBytes = videoBytes + audioBytes + captionBytes;
    if (!totalBytes) {
      return "";
    }

    const megabytes = totalBytes / (1024 * 1024);
    if (megabytes < 1) {
      return SIZE_FORMATTER_KB.format(totalBytes / 1024);
    }

    if (megabytes < 1000) {
      return SIZE_FORMATTER_MB.format(megabytes);
    }

    return SIZE_FORMATTER_GB.format(totalBytes / (1024 * 1024 * 1024));
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
      return store.isDownloading;
    },
    get isDone() {
      return store.isDone;
    },
    get progress() {
      return store.progress;
    },
    get progressType() {
      return store.progressType;
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
