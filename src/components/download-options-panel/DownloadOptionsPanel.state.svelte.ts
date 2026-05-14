import { createAudioTrackState } from "./DownloadOptionsPanel.audio.svelte";
import { createCaptionTrackState } from "./DownloadOptionsPanel.caption.svelte";
import { createDownloadProgressTracker } from "./DownloadOptionsPanel.progress.svelte";
import { createVideoFormatTracker } from "./DownloadOptionsPanel.video-format.svelte";
import {
  sendCancelDownload,
  sendDiscardInterrupted,
  sendRevealDownload,
  sendStartDownload
} from "./panel-download-actions";
import {
  IS_WATCH_PAGE,
  resolveInitialAudioCustomLanguage,
  resolveInitialAudioFormat,
  resolveInitialAudioMode,
  resolveInitialCaptionMode,
  resolveInitialCaptionTrack,
  resolveInitialDownloadType,
  resolveInitialExtension,
  resolveInitialFilename
} from "./panel-init";
import { resolveActualExtension, resolvePrimaryState, resolveQualityLabel } from "./panel-state-derived";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";
import { CONTENT_OPTIONS, downloadProgressStore, interruptedDownloadStore } from "@/lib/ui/synced-stores.svelte";
import { getCompatibleFilename, resolveAutoExtension } from "@/lib/utils/containers";
import { calculateWeightedProgress } from "@/lib/youtube/video-helpers";
import { DownloadType, type AdaptiveFormatItem, type VideoData } from "@/types";
import { untrack } from "svelte";

export function createPanelState(getVideoData: () => VideoData) {
  const storeEntry = $derived(downloadProgressStore.get(getVideoData().videoId));
  const isDownloading = $derived(storeEntry?.isDownloading ?? false);
  const isDone = $derived(storeEntry?.isDone ?? false);
  const progress = $derived(storeEntry?.progress ?? 0);
  const progressType = $derived(storeEntry?.progressType ?? "");

  let downloadId = $state<number | null>(null);
  let downloadType = $state<DownloadType>(
    untrack(() => resolveInitialDownloadType(CONTENT_OPTIONS.value, getVideoData()))
  );
  let selectedVideoFormat = $state<AdaptiveFormatItem | null>(
    untrack(() => getVideoData().videoFormats[0] ?? null)
  );
  let selectedAudioFormat = $state<AdaptiveFormatItem | null>(
    untrack(() => resolveInitialAudioFormat(CONTENT_OPTIONS.value, getVideoData()))
  );
  let filename = $state(untrack(() => resolveInitialFilename(getVideoData())));
  let extension = $state(untrack(() => resolveInitialExtension(CONTENT_OPTIONS.value, getVideoData())));
  let isFilenameValid = $state(true);

  const actualExtension = $derived(
    resolveActualExtension(downloadType, selectedVideoFormat, selectedAudioFormat, extension, getVideoData)
  );
  const isDownloadable = $derived(getVideoData().isDownloadable);
  const isInterrupted = $derived(!!interruptedDownloadStore.get(getVideoData().videoId));
  const isFailed = $derived(!!storeEntry?.isFailed);
  const primaryState = $derived(resolvePrimaryState(isDownloading, isFailed, isInterrupted, isDone));
  const displayProgress = $derived(
    calculateWeightedProgress({
      isDownloading,
      progress,
      progressType
    })
  );
  const fullFilename = $derived(getCompatibleFilename(`${filename}.${actualExtension}`));
  const qualityLabel = $derived(resolveQualityLabel(downloadType, selectedVideoFormat, selectedAudioFormat));

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

  const audio = untrack(() => {
    const options = CONTENT_OPTIONS.value;
    const videoData = getVideoData();
    return createAudioTrackState(
      getVideoData,
      value => {
        selectedAudioFormat = value;
      },
      resetDoneState,
      resolveInitialAudioMode(options, videoData),
      resolveInitialAudioCustomLanguage(options, videoData)
    );
  });

  const caption = untrack(() => {
    const options = CONTENT_OPTIONS.value;
    const videoData = getVideoData();
    const initialMode = resolveInitialCaptionMode(options, videoData);
    return createCaptionTrackState(
      getVideoData,
      initialMode,
      resolveInitialCaptionTrack(initialMode, options, videoData)
    );
  });

  createVideoFormatTracker(getVideoData, value => {
    selectedVideoFormat = value;
  });
  createDownloadProgressTracker(getVideoData, value => {
    downloadId = value;
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
    const options = CONTENT_OPTIONS.value;
    const { videoId } = getVideoData();
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
    const { selectedCaptionTrack } = caption;
    sendStartDownload(
      downloadType,
      selectedVideoFormat,
      selectedAudioFormat,
      selectedCaptionTrack,
      isDownloading,
      isDownloadable,
      isFilenameValid,
      fullFilename,
      getVideoData()
    );
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
    set selectedVideoFormat(value: AdaptiveFormatItem | null) {
      selectedVideoFormat = value; resetDoneState();
    },
    get selectedAudioFormat() {
      return selectedAudioFormat;
    },
    set selectedAudioFormat(value: AdaptiveFormatItem | null) {
      selectedAudioFormat = value; resetDoneState();
    },
    get filename() {
      return filename;
    },
    set filename(value: string) {
      filename = value; resetDoneState();
    },
    get extension() {
      return extension;
    },
    set extension(value: string) {
      extension = value; resetDoneState();
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
    get downloadId() {
      return downloadId;
    },
    get isWatchPage() {
      return IS_WATCH_PAGE;
    },
    get downloadExtras() {
      return CONTENT_OPTIONS.value.downloadExtras;
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
