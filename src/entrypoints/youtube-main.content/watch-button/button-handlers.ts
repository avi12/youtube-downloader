import type { ButtonState } from "./button-state";
import type { ButtonGroupElements, DropdownElements } from "./watch-button-dom";
import { buildChevronData, buildDownloadData } from "./watch-button-view-model";
import { CHILD_LIST_SUBTREE } from "@/lib/utils/dom";
import { ProgressType, type VideoData } from "@/types";

export type { ButtonState } from "./button-state";
export type ButtonElements = ButtonGroupElements & DropdownElements;

export { handleClickEvent } from "./button-click-handler";
export { handleProgressEvent } from "./button-progress-handler";

const DOWNLOAD_PROGRESS_SHARE = 0.8;

export function mapToBarProgress(progress: number, progressType: ProgressType) {
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

  const chevronKey = [viewState.isPanelOpen, viewState.isDownloading && !viewState.isDone, viewState.isDownloadable].join("|");
  if (chevronKey !== state.lastRenderedChevronKey) {
    state.lastRenderedChevronKey = chevronKey;
    elements.elChevronButton.data = buildChevronData(viewState);
  }

  requestAnimationFrame(applySegmentedClasses);
  elements.progressRing.setIndeterminate(state.isDownloading && viewState.downloadProgress === 0);
  elements.progressRing.setProgress(viewState.downloadProgress);
  elements.progressRing.setOpacity(state.isDownloading ? 1 : 0);
}

export function attachSegmentedObserver(elements: Pick<ButtonElements, "elDownloadButton" | "elChevronButton">, applySegmentedClasses: () => void) {
  const observer = new MutationObserver(applySegmentedClasses);
  observer.observe(elements.elDownloadButton, CHILD_LIST_SUBTREE);
  observer.observe(elements.elChevronButton, CHILD_LIST_SUBTREE);
  requestAnimationFrame(applySegmentedClasses);
  return observer;
}
