import {
  createButtonGroup,
  createDropdownElement,
  findNativeDownloadButton,
  injectWatchButtonStyles
} from "./watch-button-dom";
import {
  attachSegmentedObserver,
  type ButtonElements,
  handleClickEvent,
  refreshButtons,
  wireButtonSubscriptions
} from "./watch-button-handlers";
import { buildInitialDownloadState, type ButtonState } from "./watch-button-state";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";
import { CHILD_LIST_SUBTREE } from "@/lib/utils/dom";
import { type VideoData } from "@/types";

const VIDEO_ACTION_BUTTON_SELECTORS = [
  "#above-the-fold #top-level-buttons-computed",
  "ytd-watch-metadata #top-level-buttons-computed",
  "#top-level-buttons-computed"
];

function findFirstVisibleActionsContainer() {
  for (const selector of VIDEO_ACTION_BUTTON_SELECTORS) {
    for (const elButton of document.querySelectorAll<HTMLElement>(selector)) {
      if (elButton.offsetWidth > 0 && elButton.offsetHeight > 0) {
        return elButton;
      }
    }
  }

  return null;
}

async function findVideoActionsContainer(signal: AbortSignal) {
  const existing = findFirstVisibleActionsContainer();
  if (existing) {
    return existing;
  }

  return new Promise<HTMLElement | null>(resolve => {
    const observer = new MutationObserver(() => {
      const elVisible = findFirstVisibleActionsContainer();
      if (!elVisible) {
        return;
      }

      observer.disconnect();
      resolve(elVisible);
    });

    observer.observe(document.documentElement, CHILD_LIST_SUBTREE);
    signal.addEventListener("abort", () => {
      observer.disconnect();
      resolve(null);
    }, { once: true });
  });
}

function buildButtonState(videoData: VideoData): ButtonState {
  const { isInterrupted, videoItag, audioItag, filename, quality, downloadType } = buildInitialDownloadState(videoData);
  return {
    isDownloading: false,
    isDone: false,
    isInterrupted,
    isError: false,
    isPanelOpen: false,
    isPanelBelow: true,
    downloadProgress: 0,
    downloadProgressType: "",
    defaultVideoItag: videoItag,
    defaultAudioItag: audioItag,
    defaultFilename: filename,
    defaultQuality: quality,
    defaultDownloadType: downloadType,
    lastProgressReported: -1,
    lastRenderedButtonKey: "",
    lastRenderedChevronKey: ""
  };
}

function buildButtonElements({
  videoId, elActionsContainer, isShowNativeDownload
}: {
  videoId: string;
  elActionsContainer: HTMLElement;
  isShowNativeDownload: boolean;
}) {
  const nativeButtons = elActionsContainer.querySelectorAll("yt-button-view-model");
  const scopingClass = nativeButtons[nativeButtons.length - 1]?.getAttribute("class") ?? "";

  injectWatchButtonStyles();

  const elNativeDownload = findNativeDownloadButton(elActionsContainer);
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

  return {
    elements: {
      ...buttonGroup,
      ...dropdownElements
    },
    elNativeDownload
  };
}

function notifyPanelContentReady(videoData: VideoData, panelContentId: string) {
  void crossWorldMessenger.sendMessage(CrossWorldMessage.PanelContentReady, {
    contentId: panelContentId,
    videoData
  });
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

function evictOrphanedGroups() {
  for (const elGroup of document.querySelectorAll("[data-ytdl-download-group]")) {
    elGroup.remove();
  }

  for (const elContent of document.querySelectorAll("[id^='ytdl-panel-content']")) {
    elContent.closest("tp-yt-iron-dropdown")?.remove();
  }
}

export function cleanupSegmentedButton() {
  cleanupCurrentButton?.();
  cleanupCurrentButton = null;
  containerSearchAbort?.abort();
  containerSearchAbort = null;
}

function wireEventsAndObservers({
  state,
  videoData,
  elements,
  applySegmentedClasses,
  cancelActiveDownload
}: {
  state: ButtonState;
  videoData: VideoData;
  elements: ButtonElements;
  applySegmentedClasses: () => void;
  cancelActiveDownload: (videoId: string) => void;
}) {
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

  function handleDropdownOpened() {
    const groupRect = elements.elGroup.getBoundingClientRect();
    const dropdownRect = elements.elDropdown.getBoundingClientRect();
    state.isPanelBelow = dropdownRect.top >= groupRect.bottom;
    refreshButtons(state, videoData, elements, applySegmentedClasses);
  }

  const segmentedObserver = attachSegmentedObserver(elements, applySegmentedClasses);
  const unsubscribeAll = wireButtonSubscriptions(state, videoData, elements, applySegmentedClasses);

  elements.elGroup.addEventListener("click", handleClick);
  elements.elDropdown.addEventListener("iron-overlay-opened", handleDropdownOpened);
  elements.elDropdown.addEventListener("iron-overlay-closed", handleDropdownClosed);

  return () => {
    segmentedObserver.disconnect();
    resizeObserver.disconnect();
    elements.elGroup.removeEventListener("click", handleClick);
    elements.elDropdown.removeEventListener("iron-overlay-opened", handleDropdownOpened);
    unsubscribeAll();
    elements.elDropdown.removeEventListener("iron-overlay-closed", handleDropdownClosed);
    elements.elGroup.remove();
    elements.elDropdown.remove();
  };
}

export async function injectSegmentedDownloadButton(
  videoData: VideoData,
  cancelActiveDownload: (videoId: string) => void
) {
  cleanupSegmentedButton();
  evictOrphanedGroups();

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
  const state = buildButtonState(videoData);
  const { elements, elNativeDownload } = buildButtonElements({
    videoId,
    elActionsContainer,
    isShowNativeDownload
  });
  currentNativeDownload = elNativeDownload;

  notifyPanelContentReady(videoData, elements.panelContentId);

  function applySegmentedClasses() {
    elements.elDownloadButton.querySelector<HTMLButtonElement>("button")?.classList.add("ytSpecButtonShapeNextSegmentedStart");
    elements.elChevronButton.querySelector<HTMLButtonElement>("button")?.classList.add("ytSpecButtonShapeNextSegmentedEnd");
  }

  refreshButtons(state, videoData, elements, applySegmentedClasses);
  const teardownEvents = wireEventsAndObservers({
    state,
    videoData,
    elements,
    applySegmentedClasses,
    cancelActiveDownload
  });

  cleanupCurrentButton = () => {
    teardownEvents();
    elNativeDownload?.classList.remove("ytdl-native-hidden");
    currentNativeDownload = null;
  };
}
