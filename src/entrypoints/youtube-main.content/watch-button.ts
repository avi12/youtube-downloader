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
import { CrossWorldEvent, onCrossWorldEvent } from "@/lib/cross-world-events";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/cross-world-messenger";
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
      downloadProgressType
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

  let lastProgressReported = -1;

  function handleProgress({ data }: { data: ProgressUpdate }) {
    if (data.videoId !== videoId) {
      return;
    }

    // Dedup identical progress values to avoid thousands of redundant
    // Polymer re-renders (FFmpeg fires progress=1 thousands of times).
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

    downloadProgress = data.progress;
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

  const unsubscribeProgress = onCrossWorldEvent(
    CrossWorldEvent.ProgressUpdate,
    data => handleProgress({ data })
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
