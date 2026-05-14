import { createDownloadStoreState } from "./DownloadOptionsPanel.download-state.svelte";
import { createTrackStates } from "./DownloadOptionsPanel.tracks.svelte";
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
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";
import { CONTENT_OPTIONS, interruptedDownloadStore } from "@/lib/ui/synced-stores.svelte";
import { getCompatibleFilename } from "@/lib/utils/containers";
import { calculateWeightedProgress } from "@/lib/youtube/video-helpers";
import { DownloadType, type AdaptiveFormatItem, type VideoData } from "@/types";
import { untrack } from "svelte";

export function createPanelState(getVideoData: () => VideoData) {
  const store = createDownloadStoreState(getVideoData);

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
  const primaryState = $derived(resolvePrimaryState(store.isDownloading, store.isFailed, isInterrupted, store.isDone));
  const displayProgress = $derived(
    calculateWeightedProgress({
      isDownloading: store.isDownloading,
      progress: store.progress,
      progressType: store.progressType
    })
  );
  const fullFilename = $derived(getCompatibleFilename(`${filename}.${actualExtension}`));
  const qualityLabel = $derived(resolveQualityLabel(downloadType, selectedVideoFormat, selectedAudioFormat));

  const { audio, caption } = createTrackStates(
    getVideoData,
    value => {
      selectedAudioFormat = value;
    },
    value => {
      selectedVideoFormat = value;
    },
    store.resetDoneState,
    value => {
      downloadId = value;
    }
  );

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
    const result = applyDownloadTypeChange(newType, selectedVideoFormat, selectedAudioFormat, getVideoData().videoId);
    downloadType = result.downloadType;
    extension = result.extension;
  }

  function startDownload() {
    sendStartDownload(
      downloadType,
      selectedVideoFormat,
      selectedAudioFormat,
      caption.selectedCaptionTrack,
      store.isDownloading,
      isDownloadable,
      isFilenameValid,
      fullFilename,
      getVideoData()
    );
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
      selectedVideoFormat = value; store.resetDoneState();
    },
    get selectedAudioFormat() {
      return selectedAudioFormat;
    },
    set selectedAudioFormat(value: AdaptiveFormatItem | null) {
      selectedAudioFormat = value; store.resetDoneState();
    },
    get filename() {
      return filename;
    },
    set filename(value: string) {
      filename = value; store.resetDoneState();
    },
    get extension() {
      return extension;
    },
    set extension(value: string) {
      extension = value; store.resetDoneState();
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
