import { createDropdownElement, findNativeDownloadButton, injectWatchButtonStyles } from "./watch-button-dom";
import WatchButton from "./WatchButton.svelte";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";
import { CHILD_LIST_SUBTREE } from "@/lib/utils/dom";
import { type VideoData } from "@/types";
import { mount, unmount } from "svelte";

const VIDEO_ACTION_BUTTON_SELECTORS = [
  "#above-the-fold #top-level-buttons-computed",
  "ytd-watch-metadata #top-level-buttons-computed",
  "#top-level-buttons-computed"
];

function findFirstVisibleActionsContainer() {
  for (const selector of VIDEO_ACTION_BUTTON_SELECTORS) {
    for (const elButton of document.querySelectorAll<HTMLElement>(selector)) {
      const isVisible = elButton.offsetWidth > 0 && elButton.offsetHeight > 0;
      if (isVisible) {
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

let cleanupCurrentButton: (() => void) | null = null;
let injectionGeneration = 0;
let containerSearchAbort: AbortController | null = null;
let isShowNativeDownload = false;
let elCurrentNativeDownload: HTMLElement | null = null;

crossWorldMessenger.onMessage(CrossWorldMessage.OptionsUpdate, ({ data }) => {
  isShowNativeDownload = data.isShowNativeDownload;
  elCurrentNativeDownload?.classList.toggle("ytdl-native-hidden", !isShowNativeDownload);
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

export async function injectSegmentedDownloadButton(videoData: VideoData) {
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

  const elNativeButtons = elActionsContainer.querySelectorAll("yt-button-view-model");
  const scopingClass = elNativeButtons[elNativeButtons.length - 1]?.getAttribute("class") ?? "";
  const scopingClasses = scopingClass.match(/\S+/g) ?? [];

  injectWatchButtonStyles();

  const elNativeDownload = findNativeDownloadButton(elActionsContainer);
  if (!isShowNativeDownload && elNativeDownload) {
    elNativeDownload.classList.add("ytdl-native-hidden");
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

  const { playerResponse: _pr, ...videoDataForPanel } = videoData;
  void crossWorldMessenger.sendMessage(CrossWorldMessage.PanelContentReady, {
    contentId: panelContentId,
    videoDataJson: JSON.stringify(videoDataForPanel)
  });

  elCurrentNativeDownload = elNativeDownload;

  cleanupCurrentButton = () => {
    void unmount(component);
    elDropdown.remove();
    elNativeDownload?.classList.remove("ytdl-native-hidden");
    elCurrentNativeDownload = null;
  };
}
