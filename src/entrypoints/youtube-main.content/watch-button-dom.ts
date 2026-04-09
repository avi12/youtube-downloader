import watchButtonStyles from "./watch-button.css?inline";
import {
  IconName,
  type TpYtIronDropdownElement,
  type TpYtPaperProgressElement,
  type YtButtonViewModelElement
} from "@/types";

export interface ButtonGroupElements {
  elGroup: HTMLDivElement;
  elDownloadButton: YtButtonViewModelElement;
  elChevronButton: YtButtonViewModelElement;
  elProgressBar: TpYtPaperProgressElement;
}

export interface DropdownElements {
  elDropdown: TpYtIronDropdownElement;
  elDropdownContentSlot: HTMLElement;
  panelContentId: string;
}

export function injectWatchButtonStyles() {
  if (document.getElementById("ytdl-watch-styles")) {
    return;
  }

  const elStyle = document.createElement("style");
  elStyle.id = "ytdl-watch-styles";
  elStyle.textContent = watchButtonStyles;
  document.head.append(elStyle);
}

export function findNativeDownloadButton(elActionsContainer: HTMLElement) {
  const buttons = elActionsContainer.querySelectorAll<YtButtonViewModelElement>("yt-button-view-model");
  for (const button of buttons) {
    if (button.data?.iconName?.includes(IconName.Download)) {
      return button;
    }

    const elInnerButton = button.querySelector("button");
    if (elInnerButton?.getAttribute("aria-label")?.toLowerCase().includes("download")) {
      return button;
    }
  }

  return null;
}

export function createButtonGroup(
  elActionsContainer: HTMLElement,
  elNativeDownload: YtButtonViewModelElement | null,
  scopingClass: string
): ButtonGroupElements {
  const scopingClasses = scopingClass.match(/\S+/g) ?? [];

  const elGroup: HTMLDivElement = document.createElement("div");
  elGroup.dataset.ytdlDownloadGroup = "true";

  const elDownloadButton: YtButtonViewModelElement = document.createElement("yt-button-view-model");
  elDownloadButton.classList.add(...scopingClasses);
  elDownloadButton.dataset.ytdlDownload = "true";

  const elChevronButton: YtButtonViewModelElement = document.createElement("yt-button-view-model");
  elChevronButton.classList.add(...scopingClasses);
  // [data-ytdl-chevron] suppresses the automatic margin-left between
  // adjacent yt-button-view-model siblings so the buttons sit flush.
  elChevronButton.dataset.ytdlChevron = "true";

  const elProgressBar: TpYtPaperProgressElement = document.createElement("tp-yt-paper-progress");
  elProgressBar.classList.add("ytdl-watch-progress");

  elGroup.append(elDownloadButton, elChevronButton, elProgressBar);

  if (elNativeDownload) {
    elNativeDownload.insertAdjacentElement("beforebegin", elGroup);
  } else {
    elActionsContainer.append(elGroup);
  }

  // Polymer's Shady DOM requires updateStyles for CSS custom properties
  elProgressBar.updateStyles({
    "--paper-progress-active-color": "var(--yt-spec-call-to-action, rgb(62 166 255))",
    "--paper-progress-container-color": "transparent"
  });

  return { elGroup, elDownloadButton, elChevronButton, elProgressBar };
}

export function createDropdownElement(videoId: string, elGroup: HTMLElement): DropdownElements {
  const panelContentId = `ytdl-panel-content-${videoId}`;

  const elDropdown: TpYtIronDropdownElement = document.createElement("tp-yt-iron-dropdown");

  // ytd-menu-popup-renderer is YouTube's native popup shell: it provides
  // theme-aware background, border-radius, and box-shadow automatically.
  // Its shadow DOM exposes a default <slot>, so our Svelte content mounts
  // as light DOM children and is projected through that slot.
  const elDropdownContentSlot = document.createElement("ytd-menu-popup-renderer");
  elDropdownContentSlot.slot = "dropdown-content";
  elDropdownContentSlot.id = panelContentId;
  elDropdown.append(elDropdownContentSlot);

  const elPopupContainer = document.querySelector("ytd-popup-container") ?? document.body;
  elPopupContainer.append(elDropdown);

  // Set Polymer properties after the element is connected to the DOM
  elDropdown.positionTarget = elGroup;
  elDropdown.horizontalAlign = "left";
  elDropdown.verticalAlign = "top";
  elDropdown.noOverlap = true;
  elDropdown.dynamicAlign = true;
  elDropdown.allowOutsideScroll = false;
  elDropdown.restoreFocusOnClose = false;

  return { elDropdown, elDropdownContentSlot, panelContentId };
}
