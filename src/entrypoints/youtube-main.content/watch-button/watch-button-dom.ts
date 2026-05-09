import watchButtonStyles from "./watch-button.css?inline";
import { type TpYtIronDropdownElement } from "@/types";

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
  const buttons = elActionsContainer.querySelectorAll<import("@/types").YtButtonViewModelElement>("yt-button-view-model");
  for (const button of buttons) {
    const isDownload = button.data?.iconName?.includes("DOWNLOAD")
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

export function createDropdownElement({ videoId }: { videoId: string }): DropdownElements {
  const panelContentId = `ytdl-panel-content-${videoId}`;

  const elDropdown = document.createElement("tp-yt-iron-dropdown");
  elDropdown.dataset.ytdlWatchDropdown = "true";

  const elDropdownContentSlot = document.createElement("div");
  elDropdownContentSlot.slot = "dropdown-content";
  elDropdownContentSlot.id = panelContentId;
  elDropdownContentSlot.dataset.ytdlPanelSlot = "true";
  elDropdownContentSlot.setAttribute("role", "presentation");
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
