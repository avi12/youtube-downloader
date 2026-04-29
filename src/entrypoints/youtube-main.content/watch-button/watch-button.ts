import { attachSegmentedObserver, handleClickEvent, refreshButtons } from "./button-handlers";
import type { ButtonState } from "./button-state";
import { wireButtonSubscriptions } from "./button-subscriptions";
import { findVideoActionsContainer } from "./watch-button-container";
import {
  createButtonGroup,
  createDropdownElement,
  findNativeDownloadButton,
  injectWatchButtonStyles
} from "./watch-button-dom";
import { buildInitialDownloadState } from "./watch-button-state";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";
import { type VideoData } from "@/types";

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

  const state: ButtonState = {
    isDownloading: false,
    isDone: false,
    isInterrupted: initialState.isInterrupted,
    isPanelOpen: false,
    downloadProgress: 0,
    downloadProgressType: "",
    defaultVideoItag: initialState.videoItag,
    defaultAudioItag: initialState.audioItag,
    defaultFilename: initialState.filename,
    defaultQuality: initialState.quality,
    defaultDownloadType: initialState.downloadType,
    lastProgressReported: -1,
    lastRenderedButtonKey: "",
    lastRenderedChevronKey: ""
  };

  const nativeButtons = elActionsContainer.querySelectorAll("yt-button-view-model");
  const scopingClass = nativeButtons[nativeButtons.length - 1]?.getAttribute("class") ?? "";

  injectWatchButtonStyles();

  const elNativeDownload = findNativeDownloadButton(elActionsContainer);
  currentNativeDownload = elNativeDownload;

  if (!isShowNativeDownload && elNativeDownload) {
    elNativeDownload.classList.add("ytdl-native-hidden");
  }

  const buttonGroup = createButtonGroup({
    elActionsContainer,
    elNativeDownload,
    scopingClass
  });
  const dropdownElements = createDropdownElement({
    videoId,
    elGroup: buttonGroup.elGroup
  });
  const elements = {
    ...buttonGroup,
    ...dropdownElements
  };

  void crossWorldMessenger.sendMessage(CrossWorldMessage.PanelContentReady, {
    contentId: dropdownElements.panelContentId,
    videoData
  });

  function applySegmentedClasses() {
    elements.elDownloadButton.querySelector<HTMLButtonElement>("button")?.classList.add("ytSpecButtonShapeNextSegmentedStart");
    elements.elChevronButton.querySelector<HTMLButtonElement>("button")?.classList.add("ytSpecButtonShapeNextSegmentedEnd");
  }

  const segmentedObserver = attachSegmentedObserver(elements, applySegmentedClasses);
  refreshButtons(state, videoData, elements, applySegmentedClasses);

  function handleClick(e: Event) {
    handleClickEvent(e, state, videoData, elements, applySegmentedClasses, cancelActiveDownload);
  }

  function handleDropdownClosed() {
    if (!state.isPanelOpen) {
      return;
    }

    state.isPanelOpen = false;
    refreshButtons(state, videoData, elements, applySegmentedClasses);
    elements.elChevronButton.querySelector<HTMLButtonElement>("button")?.focus();
  }

  const resizeObserver = new ResizeObserver(() => {
    if (elements.elDropdown.opened) {
      elements.elDropdown.refit();
    }
  });
  resizeObserver.observe(elements.elDropdownContentSlot);

  const unsubscribeAll = wireButtonSubscriptions(state, videoData, elements, applySegmentedClasses);

  elements.elGroup.addEventListener("click", handleClick);
  elements.elDropdown.addEventListener("iron-overlay-closed", handleDropdownClosed);

  cleanupCurrentButton = () => {
    segmentedObserver.disconnect();
    resizeObserver.disconnect();
    elements.elGroup.removeEventListener("click", handleClick);
    unsubscribeAll();
    elements.elDropdown.removeEventListener("iron-overlay-closed", handleDropdownClosed);
    elements.elGroup.remove();
    elements.elDropdown.remove();
    elNativeDownload?.classList.remove("ytdl-native-hidden");
    currentNativeDownload = null;
  };
}
