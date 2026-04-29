import { performDownload } from "../video/download";
import type { ButtonState } from "./button-state";
import type { ButtonGroupElements, DropdownElements } from "./watch-button-dom";
import type { ButtonViewState } from "./watch-button-view-model";
import { buildChevronData, buildDownloadData } from "./watch-button-view-model";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";
import { CHILD_LIST_SUBTREE } from "@/lib/utils/dom";
import { ProgressType, type ProgressUpdate, type VideoData } from "@/types";

export type { ButtonState } from "./button-state";
export type ButtonElements = ButtonGroupElements & DropdownElements;

const DOWNLOAD_PROGRESS_SHARE = 0.8;

export function mapToBarProgress(progress: number, progressType: ProgressType): number {
  if (progressType === ProgressType.Video || progressType === ProgressType.Audio) {
    return progress * DOWNLOAD_PROGRESS_SHARE;
  }

  return DOWNLOAD_PROGRESS_SHARE + progress * (1 - DOWNLOAD_PROGRESS_SHARE);
}

export function getViewState(state: ButtonState, videoData: VideoData): ButtonViewState {
  return {
    isDownloading: state.isDownloading,
    isDone: state.isDone,
    isInterrupted: state.isInterrupted,
    isPanelOpen: state.isPanelOpen,
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

  const downloadButtonKey = [viewState.isDownloading, viewState.isDone, viewState.isInterrupted, viewState.isDownloadable, Math.round(viewState.downloadProgress * 100), state.downloadProgressType, viewState.filename, viewState.quality].join("|");
  if (downloadButtonKey !== state.lastRenderedButtonKey) {
    state.lastRenderedButtonKey = downloadButtonKey;
    elements.elDownloadButton.data = buildDownloadData(viewState);
  }

  const chevronKey = [viewState.isPanelOpen, viewState.isDownloading && !viewState.isDone, viewState.isDownloadable].join("|");
  if (chevronKey !== state.lastRenderedChevronKey) {
    state.lastRenderedChevronKey = chevronKey;
    elements.elChevronButton.data = buildChevronData(viewState);
  }

  requestAnimationFrame(applySegmentedClasses);
  elements.progressRing.setIndeterminate(state.isDownloading && state.downloadProgressType === "");
  elements.progressRing.setProgress(viewState.downloadProgress);
  elements.progressRing.setOpacity(state.isDownloading ? 1 : 0);
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

    if (state.isDownloading) {
      state.isDownloading = false;
      refreshButtons(state, videoData, elements, applySegmentedClasses);
      cancelActiveDownload(videoData.videoId);
      void crossWorldMessenger.sendMessage(CrossWorldMessage.CancelRequest, { videoIds: [videoData.videoId] });
      return;
    }

    state.isDone = false;
    state.isInterrupted = false;
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

export function handleProgressEvent(
  { data }: { data: ProgressUpdate },
  state: ButtonState,
  videoData: VideoData,
  elements: ButtonElements,
  applySegmentedClasses: () => void
) {
  if (data.videoId !== videoData.videoId) {
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
  }

  refreshButtons(state, videoData, elements, applySegmentedClasses);
}

export function attachSegmentedObserver(elements: Pick<ButtonElements, "elDownloadButton" | "elChevronButton">, applySegmentedClasses: () => void) {
  const observer = new MutationObserver(applySegmentedClasses);
  observer.observe(elements.elDownloadButton, CHILD_LIST_SUBTREE);
  observer.observe(elements.elChevronButton, CHILD_LIST_SUBTREE);
  requestAnimationFrame(applySegmentedClasses);
  return observer;
}
