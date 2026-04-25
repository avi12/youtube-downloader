import watchButtonStyles from "./watch-button.css?inline";
import { IconName, type TpYtIronDropdownElement, type YtButtonViewModelElement } from "@/types";

const PROGRESS_RING_RADIUS = 16;
const PROGRESS_RING_SVG_SIZE = 40;
const PROGRESS_RING_CIRCUMFERENCE = 2 * Math.PI * PROGRESS_RING_RADIUS;
const PROGRESS_RING_NS = "http://www.w3.org/2000/svg";

export interface ProgressRing {
  elRoot: SVGSVGElement;
  elIndicator: SVGCircleElement;
  setOpacity(value: number): void;
  setProgress(progress: number): void;
  setIndeterminate(isIndeterminate: boolean): void;
}

interface ButtonGroupElements {
  elGroup: HTMLDivElement;
  elDownloadButton: YtButtonViewModelElement;
  elChevronButton: YtButtonViewModelElement;
  progressRing: ProgressRing;
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

function createProgressRing(): ProgressRing {
  const elRoot = document.createElementNS(PROGRESS_RING_NS, "svg");
  elRoot.classList.add("ytdl-watch-progress-ring");
  elRoot.setAttribute("viewBox", `0 0 ${PROGRESS_RING_SVG_SIZE} ${PROGRESS_RING_SVG_SIZE}`);
  elRoot.setAttribute("aria-hidden", "true");

  const elTrack = document.createElementNS(PROGRESS_RING_NS, "circle");
  elTrack.classList.add("ytdl-watch-progress-ring__track");
  elTrack.setAttribute("cx", String(PROGRESS_RING_SVG_SIZE / 2));
  elTrack.setAttribute("cy", String(PROGRESS_RING_SVG_SIZE / 2));
  elTrack.setAttribute("r", String(PROGRESS_RING_RADIUS));

  const elIndicator = document.createElementNS(PROGRESS_RING_NS, "circle");
  elIndicator.classList.add("ytdl-watch-progress-ring__indicator");
  elIndicator.setAttribute("cx", String(PROGRESS_RING_SVG_SIZE / 2));
  elIndicator.setAttribute("cy", String(PROGRESS_RING_SVG_SIZE / 2));
  elIndicator.setAttribute("r", String(PROGRESS_RING_RADIUS));
  elIndicator.setAttribute("stroke-dasharray", String(PROGRESS_RING_CIRCUMFERENCE));
  elIndicator.setAttribute("stroke-dashoffset", String(PROGRESS_RING_CIRCUMFERENCE));

  elRoot.append(elTrack, elIndicator);

  return {
    elRoot,
    elIndicator,
    setOpacity(value: number) {
      elRoot.style.opacity = String(value);
    },
    setProgress(progress: number) {
      const clamped = Math.max(0, Math.min(1, progress));
      elIndicator.setAttribute("stroke-dashoffset", String(PROGRESS_RING_CIRCUMFERENCE * (1 - clamped)));
    },
    setIndeterminate(isIndeterminate: boolean) {
      elRoot.classList.toggle("ytdl-watch-progress-ring--indeterminate", isIndeterminate);
    }
  };
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

  const progressRing = createProgressRing();
  elDownloadButton.append(progressRing.elRoot);

  elGroup.append(elDownloadButton, elChevronButton);

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
}): DropdownElements {
  const panelContentId = `ytdl-panel-content-${videoId}`;

  const elDropdown = document.createElement("tp-yt-iron-dropdown");

  // ytd-menu-popup-renderer provides theme-aware background, border-radius, and box-shadow,
  // and its shadow DOM exposes a default <slot> for our content.
  const elDropdownContentSlot = document.createElement("ytd-menu-popup-renderer");
  elDropdownContentSlot.slot = "dropdown-content";
  elDropdownContentSlot.id = panelContentId;
  elDropdown.append(elDropdownContentSlot);

  // ytd-menu-popup-renderer carries role="menu" from YouTube's own element definition.
  // Our panel is a dialog, not a menu — override to presentation and hide the empty
  // Polymer listbox from assistive technologies (WCAG 4.1.2, 1.3.1).
  requestAnimationFrame(() => {
    elDropdownContentSlot.setAttribute("role", "presentation");
    elDropdownContentSlot.querySelector("tp-yt-paper-listbox")?.setAttribute("aria-hidden", "true");
  });

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
