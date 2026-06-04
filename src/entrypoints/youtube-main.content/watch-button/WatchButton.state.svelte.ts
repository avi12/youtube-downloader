import { buildClickHandler } from "./watch-button-click";
import { buildInitialDownloadState } from "./watch-button-state";
import { percentFormatter } from "./watch-button-types";
import { buildChevronData, buildDownloadData } from "./watch-button-view-model";
import { createButtonElementEffects } from "./WatchButton.button-effects.svelte";
import { createMessageEffects } from "./WatchButton.message-effects.svelte";
import { createPanelEffects } from "./WatchButton.panel-effects.svelte";
import { interruptedDownloadStore, statusProgressSignal } from "@/lib/ui/synced-stores.svelte";
import { calculateWeightedProgress } from "@/lib/youtube/video-helpers";
import { type VideoData, type YtButtonViewModelElement } from "@/types";
import { untrack } from "svelte";

const PERCENT_COMPLETE = 100;

export function createWatchButtonState(params: {
  readonly videoData: VideoData;
  readonly elDropdown: import("@/types").TpYtIronDropdownElement;
}) {
  const initial = untrack(() => buildInitialDownloadState(params.videoData));
  const { videoId } = params.videoData;

  const statusEntry = $derived(statusProgressSignal.value[videoId]);
  const isDownloading = $derived(statusEntry?.isDownloading ?? false);
  const isDone = $derived(statusEntry?.isDone ?? false);
  const isError = $derived(statusEntry?.isFailed ?? false);
  const isInterrupted = $derived(!!interruptedDownloadStore.get(videoId));
  const downloadProgressType = $derived(statusEntry?.progressType ?? "");
  const downloadProgress = $derived.by(() => {
    if (!statusEntry) {
      return 0;
    }

    return calculateWeightedProgress({
      isDownloading: statusEntry.isDownloading,
      progress: statusEntry.progress,
      progressType: statusEntry.progressType
    }) / PERCENT_COMPLETE;
  });

  let isPanelOpen = $state(false);
  let isPanelBelow = $state(true);
  let defaultVideoItag = $state(initial.videoItag);
  let defaultAudioItag = $state(initial.audioItag);
  let defaultAudioTrackId = $state(initial.audioTrackId);
  let defaultFilename = $state(initial.filename);
  let defaultQuality = $state(initial.quality);
  const defaultDownloadType = initial.downloadType;

  let elGroup = $state<HTMLDivElement | null>(null);
  let elDownloadButton = $state<YtButtonViewModelElement | null>(null);
  let elChevronButton = $state<YtButtonViewModelElement | null>(null);

  const effectiveProgress = $derived.by(() => {
    if (isDownloading) {
      return downloadProgress;
    }

    return isError ? 1 : 0;
  });

  const formattedProgress = $derived(percentFormatter.format(effectiveProgress));
  const isProgressNonZero = $derived(effectiveProgress > 0);

  const viewState = $derived({
    isDownloading,
    isDone,
    isInterrupted,
    isError,
    isPanelOpen,
    isPanelBelow,
    downloadProgress: formattedProgress,
    isProgressNonZero,
    progressType: downloadProgressType,
    filename: defaultFilename,
    quality: defaultQuality,
    isDownloadable: params.videoData.isDownloadable
  });

  const downloadData = $derived(buildDownloadData(viewState));
  const chevronData = $derived(buildChevronData(viewState));

  const downloadState = $derived.by(() => {
    if (isDone) {
      return "done";
    }

    if (isError) {
      return "error";
    }

    if (isInterrupted) {
      return "interrupted";
    }

    if (isDownloading) {
      return "downloading";
    }

    return "";
  });

  const isIndeterminate = $derived(isDownloading && downloadProgress === 0);
  const isProgressRingVisible = $derived(isDownloading || isError);

  createButtonElementEffects({
    getElDownloadButton: () => elDownloadButton,
    getElChevronButton: () => elChevronButton,
    getDownloadData: () => downloadData,
    getChevronData: () => chevronData,
    getElDropdown: () => params.elDropdown
  });

  createPanelEffects({
    getElChevronButton: () => elChevronButton,
    getElDropdown: () => params.elDropdown,
    getIsPanelOpen: () => isPanelOpen,
    getIsPanelBelow: () => isPanelBelow,
    setIsPanelOpen(value) {
      isPanelOpen = value;
    },
    setIsPanelBelow(value) {
      isPanelBelow = value;
    }
  });

  createMessageEffects({
    getIsPanelOpen: () => isPanelOpen,
    setIsPanelOpen(value) {
      isPanelOpen = value;
    },
    setters: {
      setDefaultFilename(value) {
        defaultFilename = value;
      },
      setDefaultQuality(value) {
        defaultQuality = value;
      },
      setDefaultVideoItag(value) {
        defaultVideoItag = value;
      },
      setDefaultAudioItag(value) {
        defaultAudioItag = value;
      },
      setDefaultAudioTrackId(value) {
        defaultAudioTrackId = value;
      }
    },
    getElDropdown: () => params.elDropdown
  });

  const handleClick = buildClickHandler({
    videoData: params.videoData,
    elDropdown: params.elDropdown,
    state: {
      getIsDownloading: () => isDownloading,
      getIsInterrupted: () => isInterrupted,
      getIsPanelOpen: () => isPanelOpen,
      getDefaultDownloadType: () => defaultDownloadType,
      getDefaultVideoItag: () => defaultVideoItag,
      getDefaultAudioItag: () => defaultAudioItag,
      getDefaultAudioTrackId: () => defaultAudioTrackId,
      getDefaultFilename: () => defaultFilename,
      getElDownloadButton: () => elDownloadButton,
      getElChevronButton: () => elChevronButton,
      setIsPanelOpen(value) {
        isPanelOpen = value;
      }
    }
  });

  return {
    get elGroup() {
      return elGroup;
    },
    set elGroup(value) {
      elGroup = value;
    },
    get elDownloadButton() {
      return elDownloadButton;
    },
    set elDownloadButton(value) {
      elDownloadButton = value;
    },
    get elChevronButton() {
      return elChevronButton;
    },
    set elChevronButton(value) {
      elChevronButton = value;
    },
    get downloadState() {
      return downloadState;
    },
    get isIndeterminate() {
      return isIndeterminate;
    },
    get isError() {
      return isError;
    },
    get isProgressRingVisible() {
      return isProgressRingVisible;
    },
    get effectiveProgress() {
      return effectiveProgress;
    },
    handleClick
  };
}
