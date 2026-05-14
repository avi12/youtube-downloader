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
  let elDownloadBtn: Element | null = null;
  let elChevronBtn: Element | null = null;
  let buttonRefreshTimer: ReturnType<typeof setTimeout> | null = null;

  const downloadButtonId = $derived(`btn-${params.videoId}-download`);
  const chevronButtonId = $derived(`btn-${params.videoId}-chevron`);

  function refreshDownloadButton() {
    if (!elDownloadBtn) {
      return;
    }

    const tooltip = params.itemState.buttonTooltip;
    const isDisabled = !params.itemState.videoData?.isDownloadable || params.isInProgressInZipBatch;
    const iconName = params.isInProgressInZipBatch ? IconName.CheckCircleThick : params.itemState.downloadIconName;
    sendDownloadButtonData(elDownloadBtn, downloadButtonId, tooltip, params.itemState.videoData, iconName, isDisabled);
  }

  function refreshChevronButton() {
    if (!elChevronBtn) {
      return;
    }

    const elDropdown = params.panel.elDropdown;
    const isPanelAbove = params.panel.isOpen && !!elDropdown
      && elDropdown.getBoundingClientRect().bottom <= elChevronBtn.getBoundingClientRect().top + PANEL_ABOVE_OVERLAP_PX;
    const isDisabled = !params.itemState.videoData?.isDownloadable;
    const iconName = isPanelAbove ? IconName.ExpandLess : IconName.ExpandMore;
    sendChevronButtonData(elChevronBtn, chevronButtonId, iconName, isDisabled);
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

  function setElDownloadBtn(elBtn: Element) {
    elDownloadBtn = elBtn;
  }
  function setElChevronBtn(elBtn: Element) {
    elChevronBtn = elBtn;
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
      attachDownloadButton(elButton, onDownloadClick, refreshDownloadButton, setElDownloadBtn),
    attachChevronButton: (elButton: Element) =>
      attachChevronButton(elButton, onChevronClick, refreshChevronButton, setElChevronBtn)
  };
}
