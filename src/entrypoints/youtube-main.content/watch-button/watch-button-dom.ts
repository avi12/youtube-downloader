import watchButtonStyles from "./watch-button.css?inline";
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

export function findNativeDownloadButton(elActionsContainer: HTMLElement) {
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
