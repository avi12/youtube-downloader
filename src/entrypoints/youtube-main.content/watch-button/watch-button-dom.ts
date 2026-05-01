import { createProgressRing, type ProgressRing } from "./watch-button-ring";
import watchButtonStyles from "./watch-button.css?inline";
import { IconName, type TpYtIronDropdownElement, type YtButtonViewModelElement } from "@/types";

export type { ProgressRing };

export interface ButtonGroupElements {
  elGroup: HTMLDivElement;
  elDownloadButton: YtButtonViewModelElement;
  elChevronButton: YtButtonViewModelElement;
  progressRing: ProgressRing;
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
    const isDownload = button.data?.iconName?.includes(IconName.Download)
      || (button.querySelector("button")?.getAttribute("aria-label") ?? "").toLowerCase().includes("download");
    if (!isDownload) {
      continue;
    }

    let elCurrent: HTMLElement = button;
    while (elCurrent.parentElement && elCurrent.parentElement !== elActionsContainer) {
      elCurrent = elCurrent.parentElement;
    }

    return elCurrent;
  }

  return null;
}

export function createButtonGroup({ elActionsContainer, elNativeDownload, scopingClass }: {
  elActionsContainer: HTMLElement;
  elNativeDownload: HTMLElement | null;
  scopingClass: string;
}) {
  const scopingClasses = scopingClass.match(/\S+/g) ?? [];

  const elGroup = document.createElement("div");
  elGroup.dataset.ytdlDownloadGroup = "true";

  const elDownloadButton = document.createElement("yt-button-view-model");
  elDownloadButton.classList.add(...scopingClasses, "ytdl-download-button");

  const elChevronButton = document.createElement("yt-button-view-model");
  elChevronButton.classList.add(...scopingClasses, "ytdl-chevron-button");

  const progressRing = createProgressRing();

  elGroup.append(elDownloadButton, elChevronButton, progressRing.elRoot);

  if (elNativeDownload) {
    elNativeDownload.insertAdjacentElement("beforebegin", elGroup);
  } else {
    elActionsContainer.append(elGroup);
  }

  return {
    elGroup,
    elDownloadButton,
    elChevronButton,
    progressRing
  };
}

export function createDropdownElement({ videoId, elGroup }: {
  videoId: string;
  elGroup: HTMLElement;
}) {
  const panelContentId = `ytdl-panel-content-${videoId}`;

  const elDropdown = document.createElement("tp-yt-iron-dropdown");

  const elDropdownContentSlot = document.createElement("ytd-menu-popup-renderer");
  elDropdownContentSlot.slot = "dropdown-content";
  elDropdownContentSlot.id = panelContentId;
  elDropdown.append(elDropdownContentSlot);

  requestAnimationFrame(() => {
    elDropdownContentSlot.setAttribute("role", "presentation");
    elDropdownContentSlot.querySelector("tp-yt-paper-listbox")?.setAttribute("aria-hidden", "true");
  });

  const elPopupContainer = document.querySelector("ytd-popup-container") ?? document.body;
  elPopupContainer.append(elDropdown);

  elDropdown.positionTarget = elGroup;
  elDropdown.horizontalAlign = "left";
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
