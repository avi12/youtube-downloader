import { performDownload } from "../video/download";
import { findVideoActionsContainer } from "./watch-button-container";
import {
  createButtonGroup,
  createDropdownElement,
  findNativeDownloadButton,
  injectWatchButtonStyles
} from "./watch-button-dom";
import { buildInitialDownloadState } from "./watch-button-state";
import { buildChevronData, buildDownloadData, type ButtonViewState } from "./watch-button-view-model";
import { CrossWorldEvent, onCrossWorldEvent } from "@/lib/messaging/cross-world-events";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";
import { CHILD_LIST_SUBTREE } from "@/lib/utils/dom";
import { ProgressType, type ProgressUpdate, type VideoData } from "@/types";

const DOWNLOAD_PROGRESS_SHARE = 0.8;

function mapToBarProgress(progress: number, progressType: ProgressType): number {
  if (progressType === ProgressType.Video || progressType === ProgressType.Audio) {
    return progress * DOWNLOAD_PROGRESS_SHARE;
  }

  return DOWNLOAD_PROGRESS_SHARE + progress * (1 - DOWNLOAD_PROGRESS_SHARE);
}

let cleanupCurrentButton: (() => void) | null = null;
let injectionGeneration = 0;
let containerSearchAbort: AbortController | null = null;
let isShowNativeDownload = false;
let currentNativeDownload: HTMLElement | null = null;

crossWorldMessenger.onMessage(CrossWorldMessage.OptionsUpdate, ({ data }) => {
  isShowNativeDownload = data.isShowNativeDownload;
  currentNativeDownload?.classList.toggle("ytdl-native-hidden", !isShowNativeDownload);
});

export function cleanupSegmentedButton() {
  cleanupCurrentButton?.();
  cleanupCurrentButton = null;
  containerSearchAbort?.abort();
  containerSearchAbort = null;
}

export async function injectSegmentedDownloadButton(
  videoData: VideoData,
  cancelActiveDownload: (videoId: string) => void
) {
  cleanupSegmentedButton();

  if (!videoData.isDownloadable) {
    return;
  }

  const generation = ++injectionGeneration;

  containerSearchAbort = new AbortController();
  const elActionsContainer = await findVideoActionsContainer(containerSearchAbort.signal);
  if (!elActionsContainer || generation !== injectionGeneration) {
    return;
  }

  const { videoId } = videoData;
  const initialState = buildInitialDownloadState(videoData);

  let defaultVideoItag = initialState.videoItag;
  let defaultAudioItag = initialState.audioItag;
  let defaultFilename = initialState.filename;
  let defaultQuality = initialState.quality;
  const defaultDownloadType = initialState.downloadType;

  let isDownloading = false;
  let isDone = false;
  let isInterrupted = initialState.isInterrupted;
  let isPanelOpen = false;
  let downloadProgress = 0;
  let downloadProgressType: ProgressType | "" = "";

  const nativeButtons = elActionsContainer.querySelectorAll("yt-button-view-model");
  const scopingClass = nativeButtons[nativeButtons.length - 1]?.getAttribute("class") ?? "";

  injectWatchButtonStyles();

  const elNativeDownload = findNativeDownloadButton(elActionsContainer);
  currentNativeDownload = elNativeDownload;

  if (!isShowNativeDownload && elNativeDownload) {
    elNativeDownload.classList.add("ytdl-native-hidden");
  }

  const { elGroup, elDownloadButton, elChevronButton, elProgressBar } =
    createButtonGroup({
      elActionsContainer,
      elNativeDownload,
      scopingClass
    });

  const { elDropdown, elDropdownContentSlot, panelContentId } =
    createDropdownElement({
      videoId,
      elGroup
    });

  // Must not await: sendMessage waits for a response that never comes for void handlers,
  // blocking the rest of button setup.
  void crossWorldMessenger.sendMessage(CrossWorldMessage.PanelContentReady, {
    contentId: panelContentId,
    videoData
  });

  // Polymer renders <button> into light DOM asynchronously; MutationObserver + rAF applies
  // the classes whenever the element appears or re-renders.
  function applySegmentedClasses() {
    elDownloadButton.querySelector<HTMLButtonElement>("button")
      ?.classList.add("yt-spec-button-shape-next--segmented-start");
    elChevronButton.querySelector<HTMLButtonElement>("button")
      ?.classList.add("yt-spec-button-shape-next--segmented-end");
  }

  const segmentedObserver = new MutationObserver(applySegmentedClasses);
  segmentedObserver.observe(elDownloadButton, CHILD_LIST_SUBTREE);
  segmentedObserver.observe(elChevronButton, CHILD_LIST_SUBTREE);
  requestAnimationFrame(applySegmentedClasses);

  function getViewState(): ButtonViewState {
    return {
      isDownloading,
      isDone,
      isInterrupted,
      isPanelOpen,
      downloadProgress: isDownloading ? downloadProgress : 0,
      filename: defaultFilename,
      quality: defaultQuality,
      isDownloadable: videoData.isDownloadable
    };
  }

  let lastRenderedButtonKey = "";
  let lastRenderedChevronKey = "";

  function refreshButtons() {
    const viewState = getViewState();

    const downloadButtonKey = [
      viewState.isDownloading,
      viewState.isDone,
      viewState.isInterrupted,
      viewState.isDownloadable,
      Math.round(viewState.downloadProgress * 100),
      downloadProgressType,
      viewState.filename,
      viewState.quality
    ].join("|");
    if (downloadButtonKey !== lastRenderedButtonKey) {
      lastRenderedButtonKey = downloadButtonKey;
      elDownloadButton.data = buildDownloadData(viewState);
    }

    const chevronKey = [
      viewState.isPanelOpen,
      viewState.isDownloading && !viewState.isDone,
      viewState.isDownloadable
    ].join("|");
    if (chevronKey !== lastRenderedChevronKey) {
      lastRenderedChevronKey = chevronKey;
      elChevronButton.data = buildChevronData(viewState);
    }

    requestAnimationFrame(applySegmentedClasses);

    elProgressBar.indeterminate = isDownloading && downloadProgressType === "";
    elProgressBar.value = Math.round(viewState.downloadProgress * 100);
    elProgressBar.style.opacity = isDownloading ? "1" : "0";
  }

  refreshButtons();

  function handleClick(e: Event) {
    const { target } = e;
    if (!(target instanceof Node)) {
      return;
    }

    if (elGroup.children[0]?.contains(target)) {
      if (!videoData.isDownloadable) {
        return;
      }

      if (isDownloading) {
        isDownloading = false;
        refreshButtons();
        cancelActiveDownload(videoId);
        void crossWorldMessenger.sendMessage(CrossWorldMessage.CancelRequest, { videoIds: [videoId] });
        return;
      }

      isDone = false;
      isInterrupted = false;
      isDownloading = true;
      downloadProgress = 0;
      refreshButtons();
      void performDownload({
        type: defaultDownloadType,
        videoId,
        videoItag: defaultVideoItag,
        audioItag: defaultAudioItag,
        filenameOutput: defaultFilename
      });
      return;
    }

    if (elGroup.children[1]?.contains(target)) {
      if (!videoData.isDownloadable) {
        return;
      }

      isPanelOpen = !isPanelOpen;
      refreshButtons();

      if (isPanelOpen) {
        // Polymer's click-outside would otherwise immediately close the dropdown we just opened.
        e.stopPropagation();
        elDropdown.open();
        elChevronButton.querySelector<HTMLButtonElement>("button")?.blur();
      } else {
        elDropdown.close();
      }
    }
  }

  let lastProgressReported = -1;

  function handleProgress({ data }: {
    data: ProgressUpdate;
  }) {
    if (data.videoId !== videoId) {
      return;
    }

    // FFmpeg fires progress=1 thousands of times; dedup to avoid redundant Polymer re-renders.
    if (!data.isRemoved && data.progress === lastProgressReported) {
      return;
    }

    lastProgressReported = data.isRemoved ? -1 : data.progress;

    if (data.isRemoved) {
      isDownloading = false;
      downloadProgress = 0;
      downloadProgressType = "";
      refreshButtons();
      return;
    }

    downloadProgress = mapToBarProgress(data.progress, data.progressType);
    downloadProgressType = data.progressType;

    if (data.progress >= 1 && data.progressType === ProgressType.FFmpeg) {
      isDone = true;
      isDownloading = false;
      downloadProgress = 0;
      downloadProgressType = "";
    }

    refreshButtons();
  }

  function handlePanelClosed() {
    if (!isPanelOpen) {
      return;
    }

    isPanelOpen = false;
    refreshButtons();
    elDropdown.close();
  }

  function handleDropdownClosed() {
    if (!isPanelOpen) {
      return;
    }

    isPanelOpen = false;
    refreshButtons();
    elChevronButton.querySelector<HTMLButtonElement>("button")?.focus();
  }

  // Keep the dropdown anchored to the button group when panel content resizes (e.g. tab switches).
  const resizeObserver = new ResizeObserver(() => {
    if (elDropdown.opened) {
      elDropdown.refit();
    }
  });
  resizeObserver.observe(elDropdownContentSlot);

  const unsubscribeProgress = onCrossWorldEvent({
    type: CrossWorldEvent.ProgressUpdate,
    handler: data => handleProgress({ data })
  });

  const unsubscribeDownloadProgress = crossWorldMessenger.onMessage(
    CrossWorldMessage.DownloadProgress,
    ({ data }) => {
      if (data.videoId !== videoId) {
        return;
      }

      downloadProgress = mapToBarProgress(data.progress, data.progressType);
      downloadProgressType = data.progressType;
      refreshButtons();
    }
  );

  const unsubscribePanelClosed = crossWorldMessenger.onMessage(
    CrossWorldMessage.PanelClosed,
    () => handlePanelClosed()
  );

  const unsubscribeFilenameChanged = crossWorldMessenger.onMessage(
    CrossWorldMessage.FilenameChanged,
    ({ data }) => {
      defaultFilename = data.filename;
      defaultQuality = data.quality ?? "";

      if (data.videoItag !== undefined) {
        defaultVideoItag = data.videoItag;
      }

      if (data.audioItag !== undefined) {
        defaultAudioItag = data.audioItag;
      }

      refreshButtons();
    }
  );

  elGroup.addEventListener("click", handleClick);
  elDropdown.addEventListener("iron-overlay-closed", handleDropdownClosed);

  cleanupCurrentButton = () => {
    segmentedObserver.disconnect();
    resizeObserver.disconnect();
    elGroup.removeEventListener("click", handleClick);
    unsubscribeProgress();
    unsubscribeDownloadProgress();
    unsubscribePanelClosed();
    unsubscribeFilenameChanged();
    elDropdown.removeEventListener("iron-overlay-closed", handleDropdownClosed);
    elGroup.remove();
    elDropdown.remove();
    elNativeDownload?.classList.remove("ytdl-native-hidden");
    currentNativeDownload = null;
  };
}
