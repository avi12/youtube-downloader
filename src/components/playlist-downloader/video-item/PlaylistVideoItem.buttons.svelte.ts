import { sendChevronButtonData, sendDownloadButtonData } from "./PlaylistVideoItem.button-data";
import { attachChevronButton, attachDownloadButton } from "./PlaylistVideoItem.buttons.attach";
import type { createPanelManager } from "./PlaylistVideoItem.panel.svelte";
import type { createPlaylistVideoItemState } from "./PlaylistVideoItem.state.svelte";
import { IconName } from "@/types";

const BUTTON_REFRESH_INTERVAL_MS = 250;
const PANEL_ABOVE_OVERLAP_PX = 4;

export function createButtonManager(params: {
  readonly videoId: string;
  readonly itemState: ReturnType<typeof createPlaylistVideoItemState>;
  readonly panel: ReturnType<typeof createPanelManager>;
  readonly isInProgressInZipBatch: boolean;
}) {
  let elButtonGroup: HTMLElement | null = null;
  let elDownloadButton: Element | null = null;
  let elChevronButton: Element | null = null;
  let buttonRefreshTimer: ReturnType<typeof setTimeout> | null = null;

  const downloadButtonId = $derived(`btn-${params.videoId}-download`);
  const chevronButtonId = $derived(`btn-${params.videoId}-chevron`);

  function refreshDownloadButton() {
    if (!elDownloadButton) {
      return;
    }

    const tooltip = params.itemState.buttonTooltip;
    const isDisabled = !params.itemState.videoData?.isDownloadable || params.isInProgressInZipBatch;
    const iconName = params.isInProgressInZipBatch ? IconName.CheckCircleThick : params.itemState.downloadIconName;
    sendDownloadButtonData(
      elDownloadButton, downloadButtonId, tooltip, params.itemState.videoData, iconName, isDisabled
    );
  }

  function refreshChevronButton() {
    if (!elChevronButton) {
      return;
    }

    const elDropdown = params.panel.elDropdown;
    const isPanelAbove = params.panel.isOpen && !!elDropdown
      && elDropdown.getBoundingClientRect().bottom
        <= elChevronButton.getBoundingClientRect().top + PANEL_ABOVE_OVERLAP_PX;
    const isDisabled = !params.itemState.videoData?.isDownloadable;
    const iconName = isPanelAbove ? IconName.ExpandLess : IconName.ExpandMore;
    sendChevronButtonData(elChevronButton, chevronButtonId, iconName, isDisabled);
  }

  function scheduleRefresh() {
    if (buttonRefreshTimer) {
      return;
    }

    queueMicrotask(() => {
      refreshDownloadButton(); refreshChevronButton();
    });
    buttonRefreshTimer = setTimeout(() => {
      buttonRefreshTimer = null;
    }, BUTTON_REFRESH_INTERVAL_MS);
  }

  function attachButtonGroup(elTarget: Element) {
    if (elTarget instanceof HTMLElement) {
      elButtonGroup = elTarget;
    }
  }

  function onDownloadClick() {
    if (!params.isInProgressInZipBatch) {
      queueMicrotask(() => void params.itemState.handleDownloadClick());
    }
  }

  function onChevronClick() {
    queueMicrotask(() => {
      params.panel.toggle(); refreshChevronButton();
    });
  }

  function setDownloadButtonElement(elBtn: Element) {
    elDownloadButton = elBtn;
  }
  function setChevronButtonElement(elBtn: Element) {
    elChevronButton = elBtn;
  }

  return {
    get downloadButtonId() {
      return downloadButtonId;
    },
    get chevronButtonId() {
      return chevronButtonId;
    },
    get elButtonGroup() {
      return elButtonGroup;
    },
    attachButtonGroup,
    refreshChevronButton,
    scheduleRefresh,
    attachDownloadButton: (elButton: Element) =>
      attachDownloadButton(elButton, onDownloadClick, refreshDownloadButton, setDownloadButtonElement),
    attachChevronButton: (elButton: Element) =>
      attachChevronButton(elButton, onChevronClick, refreshChevronButton, setChevronButtonElement)
  };
}
