import { buildClickHandler } from "./watch-button-click";
import { PROGRESS_RING_CIRCUMFERENCE, PROGRESS_RING_RADIUS, PROGRESS_RING_SVG_SIZE } from "./watch-button-progress";
import { buildInitialDownloadState } from "./watch-button-state";
import { buildChevronData, buildDownloadData } from "./watch-button-view-model";
import { createButtonElementEffects } from "./WatchButton.button-effects.svelte";
import { createMessageEffects } from "./WatchButton.message-effects.svelte";
import { createPanelEffects } from "./WatchButton.panel-effects.svelte";
import { ProgressType, type VideoData, type YtButtonViewModelElement } from "@/types";
import { untrack } from "svelte";

export function createWatchButtonState(params: {
  readonly videoData: VideoData;
  readonly elDropdown: import("@/types").TpYtIronDropdownElement;
}) {
  const initial = untrack(() => buildInitialDownloadState(params.videoData));

  let isDownloading = $state(false);
  let isDone = $state(false);
  let isInterrupted = $state(initial.isInterrupted);
  let isError = $state(false);
  let isPanelOpen = $state(false);
  let isPanelBelow = $state(true);
  let downloadProgress = $state(0);
  let downloadProgressType = $state<ProgressType | "">("");
  let defaultVideoItag = $state(initial.videoItag);
  let defaultAudioItag = $state(initial.audioItag);
  let defaultAudioTrackId = $state(initial.audioTrackId);
  let defaultFilename = $state(initial.filename);
  let defaultQuality = $state(initial.quality);
  const defaultDownloadType = initial.downloadType;
  let lastProgressReported = $state("");

  let elGroup = $state<HTMLDivElement | null>(null);
  let elDownloadButton = $state<YtButtonViewModelElement | null>(null);
  let elChevronButton = $state<YtButtonViewModelElement | null>(null);

  const effectiveProgress = $derived.by(() => {
    if (isDownloading) {
      return downloadProgress;
    }

    return isError ? 1 : 0;
  });

  const viewState = $derived({
    isDownloading,
    isDone,
    isInterrupted,
    isError,
    isPanelOpen,
    isPanelBelow,
    downloadProgress: effectiveProgress,
    progressType: downloadProgressType,
    filename: defaultFilename,
    quality: defaultQuality,
    isDownloadable: params.videoData.isDownloadable
  });

  const downloadData = $derived(buildDownloadData(viewState));
  const chevronData = $derived(buildChevronData(viewState));

  const stateClass = $derived.by(() => {
    if (isDone) {
      return "ytdl-watch-state-done";
    }

    if (isError) {
      return "ytdl-watch-state-error";
    }

    if (isInterrupted) {
      return "ytdl-watch-state-interrupted";
    }

    if (isDownloading) {
      return "ytdl-watch-state-downloading";
    }

    return "";
  });

  const isIndeterminate = $derived(isDownloading && downloadProgress === 0);

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
    videoId: params.videoData.videoId,
    handlers: {
      setIsDownloading(value) {
        isDownloading = value;
      },
      setIsDone(value) {
        isDone = value;
      },
      setIsError(value) {
        isError = value;
      },
      setIsInterrupted(value) {
        isInterrupted = value;
      },
      setDownloadProgress(value) {
        downloadProgress = value;
      },
      setDownloadProgressType(value) {
        downloadProgressType = value;
      },
      setLastProgressReported(value) {
        lastProgressReported = value;
      },
      getIsDone: () => isDone,
      getLastProgressReported: () => lastProgressReported
    },
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
      setIsDownloading(value) {
        isDownloading = value;
      },
      setIsInterrupted(value) {
        isInterrupted = value;
      },
      setIsDone(value) {
        isDone = value;
      },
      setIsError(value) {
        isError = value;
      },
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
    get stateClass() {
      return stateClass;
    },
    get isIndeterminate() {
      return isIndeterminate;
    },
    get isError() {
      return isError;
    },
    get effectiveProgress() {
      return effectiveProgress;
    },
    PROGRESS_RING_RADIUS,
    PROGRESS_RING_SVG_SIZE,
    PROGRESS_RING_CIRCUMFERENCE,
    handleClick
  };
}
