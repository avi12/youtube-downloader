import { performDownload } from "./download";
import { findVideoActionsContainer } from "./watch-button-container";
import {
  createButtonGroup,
  createDropdownElement,
  findNativeDownloadButton,
  injectWatchButtonStyles
} from "./watch-button-dom";
import { buildInitialDownloadState } from "./watch-button-state";
import { buildChevronData, buildDownloadData, type ButtonViewState } from "./watch-button-view-model";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/cross-world-messenger";
import { calculateWeightedProgress } from "@/lib/utils";
import { ProgressType, type ProgressUpdate, type VideoData } from "@/types";

let cleanupCurrentButton: (() => void) | null = null;
let injectionGeneration = 0;
let containerSearchAbort: AbortController | null = null;

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

  // Grab Polymer CSS scoping class from last native yt-button-view-model
  const nativeButtons = elActionsContainer.querySelectorAll("yt-button-view-model");
  const scopingClass = nativeButtons[nativeButtons.length - 1]?.getAttribute("class") ?? "";

  injectWatchButtonStyles();

  const elNativeDownload = findNativeDownloadButton(elActionsContainer);
  if (elNativeDownload) {
    elNativeDownload.classList.add("ytdl-native-hidden");
  }

  const { elGroup, elDownloadButton, elChevronButton, elProgressBar } =
    createButtonGroup(elActionsContainer, elNativeDownload, scopingClass);

  const { elDropdown, elDropdownContentSlot, panelContentId } =
    createDropdownElement(videoId, elGroup);

  // Notify the isolated world where to mount the Svelte panel.
  // Fire-and-forget: must not await, or the button setup below never runs
  // (sendMessage waits for a response that never comes for void handlers).
  void crossWorldMessenger.sendMessage(CrossWorldMessage.PanelContentReady, {
    contentId: panelContentId,
    videoData
  });

  // Polymer renders <button> into light DOM asynchronously.
  // We use a MutationObserver + requestAnimationFrame to apply the classes
  // as soon as the element is available (and after any re-render).
  function applySegmentedClasses() {
    elDownloadButton.querySelector<HTMLButtonElement>("button")
      ?.classList.add("yt-spec-button-shape-next--segmented-start");
    elChevronButton.querySelector<HTMLButtonElement>("button")
      ?.classList.add("yt-spec-button-shape-next--segmented-end");
  }

  const segmentedObserver = new MutationObserver(applySegmentedClasses);
  segmentedObserver.observe(elDownloadButton, { childList: true, subtree: true });
  segmentedObserver.observe(elChevronButton, { childList: true, subtree: true });
  requestAnimationFrame(applySegmentedClasses);

  function getViewState(): ButtonViewState {
    const weightedProgress = calculateWeightedProgress(isDownloading, downloadProgress, downloadProgressType) / 100;
    return {
      isDownloading,
      isDone,
      isInterrupted,
      isPanelOpen,
      downloadProgress: weightedProgress,
      filename: defaultFilename,
      quality: defaultQuality,
      isDownloadable: videoData.isDownloadable
    };
  }

  function refreshButtons() {
    const viewState = getViewState();
    elDownloadButton.data = buildDownloadData(viewState);
    elChevronButton.data = buildChevronData(viewState);
    requestAnimationFrame(applySegmentedClasses);

    elProgressBar.indeterminate = isDownloading && downloadProgress === 0;
    elProgressBar.value = Math.round(viewState.downloadProgress * 100);
    elProgressBar.style.opacity = isDownloading ? "1" : "0";
  }

  // Set initial button data after all elements are ready
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
        // Stop propagation so Polymer's click-outside handler
        // doesn't immediately close the dropdown we just opened
        e.stopPropagation();
        elDropdown.open();
        elChevronButton.querySelector<HTMLButtonElement>("button")?.blur();
      } else {
        elDropdown.close();
      }
    }
  }

  function handleProgress({ data }: { data: ProgressUpdate }) {
    if (data.videoId !== videoId) {
      return;
    }

    if (data.isRemoved === true) {
      isDownloading = false;
      downloadProgress = 0;
      downloadProgressType = "";
      refreshButtons();
      return;
    }

    downloadProgress = data.progress;
    downloadProgressType = data.progressType;

    if (data.progress >= 1) {
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

  // From Polymer (click-outside, Escape key): sync MAIN world state
  function handleDropdownClosed() {
    if (!isPanelOpen) {
      return;
    }

    isPanelOpen = false;
    refreshButtons();
    // Restore focus to the chevron button
    elChevronButton.querySelector<HTMLButtonElement>("button")?.focus();
  }

  // Refit the dropdown whenever the panel content resizes (e.g. switching tabs)
  // so the dropdown stays anchored to the button group rather than floating away.
  const resizeObserver = new ResizeObserver(() => {
    if (elDropdown.opened) {
      elDropdown.refit();
    }
  });
  resizeObserver.observe(elDropdownContentSlot);

  const unsubscribeProgress = crossWorldMessenger.onMessage(
    CrossWorldMessage.Progress,
    handleProgress
  );

  const unsubscribeDownloadProgress = crossWorldMessenger.onMessage(
    CrossWorldMessage.DownloadProgress,
    ({ data }) => {
      if (data.videoId !== videoId) {
        return;
      }

      downloadProgress = data.progress;
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
  };
}
