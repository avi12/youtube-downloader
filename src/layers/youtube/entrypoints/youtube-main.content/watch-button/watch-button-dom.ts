import { findShortsActionsContainer } from "./watch-button-container";
import watchButtonStyles from "./watch-button.css?inline";
import { CHILD_LIST_SUBTREE } from "@/lib/utils/dom";
import { readElementIconName } from "@/lib/youtube/schemas";
import { type Prettify, type TpYtIronDropdownElement } from "@/types";

const WATCH_STYLES_ELEMENT_ID = "ytdl-watch-styles";
const PANEL_CONTENT_ID_PREFIX = "ytdl-panel-content-";
const IRON_DROPDOWN_TAG = "tp-yt-iron-dropdown";
const NATIVE_DOWNLOAD_ICON_KEYWORD = "DOWNLOAD";
const NATIVE_DOWNLOAD_ARIA_KEYWORD = "download";
const YT_BUTTON_VIEW_MODEL_TAG = "yt-button-view-model";
const INNER_BUTTON_TAG = "button";
const ATTR_ARIA_LABEL = "aria-label";
const ATTR_ROLE = "role";
const ATTR_ROLE_PRESENTATION = "presentation";

export type DropdownElements = Prettify<{
  elDropdown: TpYtIronDropdownElement;
  elDropdownContentSlot: HTMLElement;
  panelContentId: string;
}>;

export function injectWatchButtonStyles() {
  if (document.getElementById(WATCH_STYLES_ELEMENT_ID)) {
    return;
  }

  const elStyle = document.createElement("style");
  elStyle.id = WATCH_STYLES_ELEMENT_ID;
  elStyle.textContent = watchButtonStyles;
  document.head.append(elStyle);
}

function findNativeDownloadButton(elActionsContainer: HTMLElement) {
  const elButtons = elActionsContainer.querySelectorAll<import("@/types").YtButtonViewModelElement>(YT_BUTTON_VIEW_MODEL_TAG);
  for (const elButton of elButtons) {
    const isDownloadIconPresent = elButton.data?.iconName?.includes(NATIVE_DOWNLOAD_ICON_KEYWORD);
    const isDownloadAriaLabelPresent = (elButton.querySelector(INNER_BUTTON_TAG)?.getAttribute(ATTR_ARIA_LABEL) ?? "").toLowerCase().includes(NATIVE_DOWNLOAD_ARIA_KEYWORD);
    const isDownload = isDownloadIconPresent || isDownloadAriaLabelPresent;
    if (!isDownload) {
      continue;
    }

    let elCurrent: HTMLElement = elButton;
    while (elCurrent.parentElement && elCurrent.parentElement !== elActionsContainer) {
      elCurrent = elCurrent.parentElement;
    }

    return elCurrent;
  }

  return null;
}

const SHORTS_SHARE_ICON_NAME = "SHORTS_SHARE";
const SHORTS_RAIL_BUTTON_TAG = "button-view-model";
const SHORTS_ROOT_TAG = "ytd-shorts";
const BUTTON_VIEW_MODEL_HOST_CLASS = "ytSpecButtonViewModelHost";

function findShortsShareItem(elActionsContainer: HTMLElement) {
  for (const elItem of elActionsContainer.children) {
    if (readElementIconName(elItem) === SHORTS_SHARE_ICON_NAME) {
      return elItem;
    }
  }

  return null;
}

export function findShortsPlacement(elActionsContainer: HTMLElement) {
  const elRailButton = elActionsContainer.querySelector(`:scope > ${SHORTS_RAIL_BUTTON_TAG}`);
  const railClasses = [...elRailButton?.classList ?? []];
  return {
    elAnchor: null,
    elNativeDownload: null,
    scopingClasses: railClasses.filter(className => className !== BUTTON_VIEW_MODEL_HOST_CLASS)
  };
}

// Each swipe swaps the rail for a fresh one and Share hydrates after the rail appears,
// so the group is re-placed after the current rail's Share on every change
export function pinShortsGroup(elGroup: Element) {
  function placeAfterShare() {
    const elActionsContainer = findShortsActionsContainer();
    if (!elActionsContainer) {
      return;
    }

    const elShare = findShortsShareItem(elActionsContainer);
    const isPlaced = elShare ? elShare.nextElementSibling === elGroup : elGroup.parentElement === elActionsContainer;
    if (isPlaced) {
      return;
    }

    if (elShare) {
      elShare.after(elGroup);
      return;
    }

    elActionsContainer.append(elGroup);
  }

  const observer = new MutationObserver(placeAfterShare);
  observer.observe(document.querySelector(SHORTS_ROOT_TAG) ?? document.body, CHILD_LIST_SUBTREE);
  placeAfterShare();
  return () => observer.disconnect();
}

export function findWatchPlacement(elActionsContainer: HTMLElement) {
  const elNativeButtons = elActionsContainer.querySelectorAll(YT_BUTTON_VIEW_MODEL_TAG);
  const scopingClass = elNativeButtons[elNativeButtons.length - 1]?.getAttribute("class") ?? "";
  const elNativeDownload = findNativeDownloadButton(elActionsContainer);
  return {
    elAnchor: elNativeDownload,
    elNativeDownload,
    scopingClasses: scopingClass.match(/\S+/g) ?? []
  };
}

export function createDropdownElement({ videoId }: { videoId: string }) {
  const panelContentId = `${PANEL_CONTENT_ID_PREFIX}${videoId}`;

  const elDropdown = document.createElement(IRON_DROPDOWN_TAG);
  elDropdown.dataset.ytdlWatchDropdown = "true";

  const elDropdownContentSlot = document.createElement("div");
  elDropdownContentSlot.slot = "dropdown-content";
  elDropdownContentSlot.id = panelContentId;
  elDropdownContentSlot.dataset.ytdlPanelSlot = "true";
  elDropdownContentSlot.setAttribute(ATTR_ROLE, ATTR_ROLE_PRESENTATION);
  elDropdown.append(elDropdownContentSlot);

  document.body.append(elDropdown);

  elDropdown.horizontalAlign = "center";
  elDropdown.verticalAlign = "top";
  elDropdown.noOverlap = true;
  elDropdown.dynamicAlign = true;
  elDropdown.allowOutsideScroll = false;
  elDropdown.restoreFocusOnClose = false;

  return {
    elDropdown,
    elDropdownContentSlot,
    panelContentId
  };
}
