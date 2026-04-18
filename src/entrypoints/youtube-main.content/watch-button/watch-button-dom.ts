import watchButtonStyles from "./watch-button.css?inline";
import {
  IconName,
  type TpYtIronDropdownElement,
  type TpYtPaperProgressElement,
  type YtButtonViewModelElement
} from "@/types";

interface ButtonGroupElements {
  elGroup: HTMLDivElement;
  elDownloadButton: YtButtonViewModelElement;
  elChevronButton: YtButtonViewModelElement;
  elProgressBar: TpYtPaperProgressElement;
}

interface DropdownElements {
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
      || /download/i.test(button.querySelector("button")?.getAttribute("aria-label") ?? "");
    if (!isDownload) {
      continue;
    }

    // Walk up to find the direct child of elActionsContainer so the entire
    // native component (which may nest multiple chevrons) gets hidden/replaced.
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
}): ButtonGroupElements {
  const scopingClasses = scopingClass.match(/\S+/g) ?? [];

  const elGroup = document.createElement("div");
  elGroup.dataset.ytdlDownloadGroup = "true";

  const elDownloadButton = document.createElement("yt-button-view-model");
  elDownloadButton.classList.add(...scopingClasses);
  elDownloadButton.dataset.ytdlDownload = "true";

  const elChevronButton = document.createElement("yt-button-view-model");
  elChevronButton.classList.add(...scopingClasses);
  // Suppresses the automatic margin-left between adjacent yt-button-view-model siblings so the buttons sit flush.
  elChevronButton.dataset.ytdlChevron = "true";

  const elProgressBar = document.createElement("tp-yt-paper-progress");
  elProgressBar.classList.add("ytdl-watch-progress");
  elProgressBar.max = 100;

  elGroup.append(elDownloadButton, elChevronButton, elProgressBar);

  if (elNativeDownload) {
    elNativeDownload.insertAdjacentElement("beforebegin", elGroup);
  } else {
    elActionsContainer.append(elGroup);
  }

  // Polymer's Shady DOM requires updateStyles for CSS custom properties.
  elProgressBar.updateStyles({
    "--paper-progress-active-color": "var(--yt-spec-call-to-action, rgb(62 166 255))",
    "--paper-progress-container-color": "transparent"
  });

  return {
    elGroup,
    elDownloadButton,
    elChevronButton,
    elProgressBar
  };
}

export function createDropdownElement({ videoId, elGroup }: {
  videoId: string;
  elGroup: HTMLElement;
}): DropdownElements {
  const panelContentId = `ytdl-panel-content-${videoId}`;

  const elDropdown = document.createElement("tp-yt-iron-dropdown");

  // ytd-menu-popup-renderer provides theme-aware background, border-radius, and box-shadow,
  // and its shadow DOM exposes a default <slot> for our content.
  const elDropdownContentSlot = document.createElement("ytd-menu-popup-renderer");
  elDropdownContentSlot.slot = "dropdown-content";
  elDropdownContentSlot.id = panelContentId;
  elDropdown.append(elDropdownContentSlot);

  const elPopupContainer = document.querySelector("ytd-popup-container") ?? document.body;
  elPopupContainer.append(elDropdown);

  // Polymer properties must be set after the element is connected to the DOM.
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
