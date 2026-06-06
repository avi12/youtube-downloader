import { findVideoActionsContainer } from "./watch-button-container";
import { createDropdownElement, findNativeDownloadButton, injectWatchButtonStyles } from "./watch-button-dom";
import WatchButton from "./WatchButton.svelte";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";
import { type VideoData } from "@/types";
import { mount, unmount } from "svelte";

const DOWNLOAD_GROUP_SELECTOR = "[data-ytdl-download-group]";
const PANEL_CONTENT_ID_SELECTOR = "[id^='ytdl-panel-content']";
const IRON_DROPDOWN_TAG = "tp-yt-iron-dropdown";
const YT_BUTTON_VIEW_MODEL_TAG = "yt-button-view-model";
const NATIVE_HIDDEN_CLASS = "ytdl-native-hidden";

let cleanupCurrentButton: (() => void) | null = null;
let injectionGeneration = 0;
let containerSearchAbort: AbortController | null = null;
let isShowNativeDownload = false;
let elCurrentNativeDownload: HTMLElement | null = null;

crossWorldMessenger.onMessage(CrossWorldMessage.OptionsUpdate, ({ data }) => {
  isShowNativeDownload = data.isShowNativeDownload;
  elCurrentNativeDownload?.classList.toggle(NATIVE_HIDDEN_CLASS, !isShowNativeDownload);
});

function evictOrphanedGroups() {
  for (const elGroup of document.querySelectorAll(DOWNLOAD_GROUP_SELECTOR)) {
    elGroup.remove();
  }

  for (const elContent of document.querySelectorAll(PANEL_CONTENT_ID_SELECTOR)) {
    elContent.closest(IRON_DROPDOWN_TAG)?.remove();
  }
}

export function cleanupSegmentedButton() {
  cleanupCurrentButton?.();
  cleanupCurrentButton = null;
  containerSearchAbort?.abort();
  containerSearchAbort = null;
}

export async function injectSegmentedDownloadButton(videoData: VideoData) {
  cleanupSegmentedButton();
  evictOrphanedGroups();

  if (!videoData.isDownloadable) {
    return;
  }

  const generation = ++injectionGeneration;
  containerSearchAbort = new AbortController();
  const elActionsContainer = await findVideoActionsContainer(containerSearchAbort.signal);
  const isStaleOrAborted = !elActionsContainer || generation !== injectionGeneration;
  if (isStaleOrAborted) {
    return;
  }

  const { videoId } = videoData;

  const elNativeButtons = elActionsContainer.querySelectorAll(YT_BUTTON_VIEW_MODEL_TAG);
  const scopingClass = elNativeButtons[elNativeButtons.length - 1]?.getAttribute("class") ?? "";
  const scopingClasses = scopingClass.match(/\S+/g) ?? [];

  injectWatchButtonStyles();

  const elNativeDownload = findNativeDownloadButton(elActionsContainer);
  const shouldHideNativeDownload = !isShowNativeDownload && elNativeDownload;
  if (shouldHideNativeDownload) {
    elNativeDownload.classList.add(NATIVE_HIDDEN_CLASS);
  }

  const { elDropdown, elDropdownContentSlot, panelContentId } = createDropdownElement({ videoId });

  const component = mount(WatchButton, {
    target: elActionsContainer,
    anchor: elNativeDownload ?? undefined,
    props: {
      videoData,
      elDropdown,
      scopingClasses
    }
  });

  elDropdownContentSlot.id = panelContentId;

  const { playerResponse, ...videoDataForPanel } = videoData;
  await crossWorldMessenger.sendMessage(CrossWorldMessage.PanelContentReady, {
    contentId: panelContentId,
    videoDataJson: JSON.stringify(videoDataForPanel)
  });

  elCurrentNativeDownload = elNativeDownload;

  cleanupCurrentButton = () => {
    unmount(component).catch(() => {});
    elDropdown.remove();
    elNativeDownload?.classList.remove(NATIVE_HIDDEN_CLASS);
    elCurrentNativeDownload = null;
  };
}
