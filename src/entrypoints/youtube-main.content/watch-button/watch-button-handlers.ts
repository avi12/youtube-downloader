import { performDownload } from "../video/download";
import type { ButtonGroupElements, DropdownElements } from "./watch-button-dom";
import type { ButtonState } from "./watch-button-state";
import { buildChevronData, buildDownloadData } from "./watch-button-view-model";
import { CrossWorldEvent, onCrossWorldEvent } from "@/lib/messaging/cross-world-events";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";
import { CHILD_LIST_SUBTREE } from "@/lib/utils/dom";
import { ProgressType, type ProgressUpdate, type VideoData } from "@/types";

export type ButtonElements = ButtonGroupElements & DropdownElements;

const DOWNLOAD_PROGRESS_SHARE = 0.8;

const WATCH_STATE_CLASSES = [
  "ytdl-watch-state-done",
  "ytdl-watch-state-error",
  "ytdl-watch-state-interrupted",
  "ytdl-watch-state-downloading",
  "ytdl-watch-state-resuming"
] as const;

function pickStateClass(state: ButtonState) {
  if (state.isDone) {
    return "ytdl-watch-state-done";
  }

  if (state.isError) {
    return "ytdl-watch-state-error";
  }

  if (state.isInterrupted) {
    return "ytdl-watch-state-interrupted";
  }

  if (state.isDownloading) {
    return "ytdl-watch-state-downloading";
  }

  return "";
}

function mapToBarProgress(progress: number, progressType: ProgressType) {
  if (progressType === ProgressType.Video || progressType === ProgressType.Audio) {
    return progress * DOWNLOAD_PROGRESS_SHARE;
  }

  return DOWNLOAD_PROGRESS_SHARE + progress * (1 - DOWNLOAD_PROGRESS_SHARE);
}

function getViewState(state: ButtonState, videoData: VideoData) {
  return {
    isDownloading: state.isDownloading,
    isDone: state.isDone,
    isInterrupted: state.isInterrupted,
    isError: state.isError,
    isPanelOpen: state.isPanelOpen,
    isPanelBelow: state.isPanelBelow,
    downloadProgress: state.isDownloading ? state.downloadProgress : 0,
    filename: state.defaultFilename,
    quality: state.defaultQuality,
    isDownloadable: videoData.isDownloadable
  };
}

export function refreshButtons(
  state: ButtonState,
  videoData: VideoData,
  elements: ButtonElements,
  applySegmentedClasses: () => void
) {
  const viewState = getViewState(state, videoData);

  const downloadButtonKey = [viewState.isDownloading, viewState.isDone, viewState.isInterrupted, viewState.isError, viewState.isDownloadable, Math.round(viewState.downloadProgress * 100), state.downloadProgressType, viewState.filename, viewState.quality].join("|");
  if (downloadButtonKey !== state.lastRenderedButtonKey) {
    state.lastRenderedButtonKey = downloadButtonKey;
    elements.elDownloadButton.data = buildDownloadData(viewState);
  }

  const chevronKey = [viewState.isPanelOpen, viewState.isPanelBelow, viewState.isDownloading && !viewState.isDone, viewState.isDownloadable].join("|");
  if (chevronKey !== state.lastRenderedChevronKey) {
    state.lastRenderedChevronKey = chevronKey;
    elements.elChevronButton.data = buildChevronData(viewState);
  }

  requestAnimationFrame(applySegmentedClasses);
  elements.progressRing.setIndeterminate(state.isDownloading && viewState.downloadProgress === 0);
  elements.progressRing.setProgress(viewState.downloadProgress);
  elements.progressRing.setOpacity(state.isDownloading ? 1 : 0);

  const stateClass = pickStateClass(state);
  for (const className of WATCH_STATE_CLASSES) {
    elements.elGroup.classList.toggle(className, className === stateClass);
  }
}

export function attachSegmentedObserver(elements: Pick<ButtonElements, "elDownloadButton" | "elChevronButton">, applySegmentedClasses: () => void) {
  const observer = new MutationObserver(applySegmentedClasses);
  observer.observe(elements.elDownloadButton, CHILD_LIST_SUBTREE);
  observer.observe(elements.elChevronButton, CHILD_LIST_SUBTREE);
  requestAnimationFrame(applySegmentedClasses);
  return observer;
}

export function handleClickEvent(
  e: Event,
  state: ButtonState,
  videoData: VideoData,
  elements: ButtonElements,
  applySegmentedClasses: () => void,
  cancelActiveDownload: (videoId: string) => void
) {
  const { target } = e;
  if (!(target instanceof Node)) {
    return;
  }

  const { elGroup, elChevronButton, elDropdown } = elements;
  if (elGroup.children[0]?.contains(target)) {
    if (!videoData.isDownloadable) {
      return;
    }

    // Per the design: clicking the pill mid-download (or during resume/interrupted)
    // cancels. The button label is "Stop {percent}%" so the action is explicit.
    if (state.isDownloading || state.isInterrupted) {
      state.isDownloading = false;
      state.isInterrupted = false;
      refreshButtons(state, videoData, elements, applySegmentedClasses);
      cancelActiveDownload(videoData.videoId);
      void crossWorldMessenger.sendMessage(CrossWorldMessage.CancelRequest, { videoIds: [videoData.videoId] });
      return;
    }

    state.isDone = false;
    state.isInterrupted = false;
    state.isError = false;
    state.isDownloading = true;
    state.downloadProgress = 0;
    refreshButtons(state, videoData, elements, applySegmentedClasses);
    void performDownload({
      type: state.defaultDownloadType,
      videoId: videoData.videoId,
      videoItag: state.defaultVideoItag,
      audioItag: state.defaultAudioItag,
      filenameOutput: state.defaultFilename
    });
    return;
  }

  if (elGroup.children[1]?.contains(target)) {
    if (!videoData.isDownloadable) {
      return;
    }

    state.isPanelOpen = !state.isPanelOpen;
    refreshButtons(state, videoData, elements, applySegmentedClasses);

    if (state.isPanelOpen) {
      e.stopPropagation();
      elDropdown.open();
      elChevronButton.querySelector<HTMLButtonElement>("button")?.blur();
    } else {
      elDropdown.close();
    }
  }
}

function handleProgressEvent(
  { data }: { data: ProgressUpdate },
  state: ButtonState,
  videoData: VideoData,
  elements: ButtonElements,
  applySegmentedClasses: () => void
) {
  if (data.videoId !== videoData.videoId) {
    return;
  }

  if (state.isDone) {
    return;
  }

  if (!data.isRemoved && data.progress === state.lastProgressReported) {
    return;
  }

  state.lastProgressReported = data.isRemoved ? -1 : data.progress;

  if (data.isRemoved) {
    state.isDownloading = false;
    state.downloadProgress = 0;
    state.downloadProgressType = "";

    if (data.isFailed) {
      state.isError = true;
    }

    refreshButtons(state, videoData, elements, applySegmentedClasses);
    return;
  }

  state.downloadProgress = mapToBarProgress(data.progress, data.progressType);
  state.downloadProgressType = data.progressType;

  if (data.progress >= 1 && data.progressType === ProgressType.FFmpeg) {
    state.isDone = true;
    state.isDownloading = false;
    state.downloadProgress = 0;
    state.downloadProgressType = "";
  } else {
    state.isDownloading = true;
  }

  refreshButtons(state, videoData, elements, applySegmentedClasses);
}

export function wireButtonSubscriptions(
  state: ButtonState,
  videoData: VideoData,
  elements: ButtonElements,
  applySegmentedClasses: () => void
): () => void {
  const unsubscribeProgress = onCrossWorldEvent({
    type: CrossWorldEvent.ProgressUpdate,
    handler: data => handleProgressEvent({ data }, state, videoData, elements, applySegmentedClasses)
  });

  const unsubscribePanelClosed = crossWorldMessenger.onMessage(CrossWorldMessage.PanelClosed, () => {
    if (!state.isPanelOpen) {
      return;
    }

    state.isPanelOpen = false;
    refreshButtons(state, videoData, elements, applySegmentedClasses);
    elements.elDropdown.close();
  });

  const unsubscribeFilenameChanged = crossWorldMessenger.onMessage(CrossWorldMessage.FilenameChanged, ({ data }) => {
    state.defaultFilename = data.filename;
    state.defaultQuality = data.quality ?? "";

    if (data.videoItag !== undefined) {
      state.defaultVideoItag = data.videoItag;
    }

    if (data.audioItag !== undefined) {
      state.defaultAudioItag = data.audioItag;
    }

    refreshButtons(state, videoData, elements, applySegmentedClasses);
  });

  return () => {
    unsubscribeProgress();
    unsubscribePanelClosed();
    unsubscribeFilenameChanged();
  };
}
