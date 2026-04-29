import { attachSegmentedObserver, handleClickEvent, refreshButtons } from "./button-handlers";
import { wireButtonSubscriptions } from "./button-subscriptions";
import { findVideoActionsContainer } from "./watch-button-container";
import { buildButtonElements, buildButtonState, notifyPanelContentReady } from "./watch-button-setup";
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

type ButtonElements = ReturnType<typeof buildButtonElements>["elements"];
type ButtonState = ReturnType<typeof buildButtonState>;

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

  const segmentedObserver = attachSegmentedObserver(elements, applySegmentedClasses);
  const unsubscribeAll = wireButtonSubscriptions(state, videoData, elements, applySegmentedClasses);

  elements.elGroup.addEventListener("click", handleClick);
  elements.elDropdown.addEventListener("iron-overlay-closed", handleDropdownClosed);

  return () => {
    segmentedObserver.disconnect();
    resizeObserver.disconnect();
    elements.elGroup.removeEventListener("click", handleClick);
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
