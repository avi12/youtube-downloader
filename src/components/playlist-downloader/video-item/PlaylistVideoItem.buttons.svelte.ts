import { sendChevronButtonData, sendDownloadButtonData } from "./PlaylistVideoItem.button-data";
import { attachChevronButton, attachDownloadButton } from "./PlaylistVideoItem.buttons.attach";
import type { createPanelManager } from "./PlaylistVideoItem.panel.svelte";
import type { createPlaylistVideoItemState } from "./PlaylistVideoItem.state.svelte";
import { IconName } from "@/types";

const BUTTON_REFRESH_INTERVAL_MS = 250;

export function createButtonManager(params: {
  readonly videoId: string;
  readonly itemState: ReturnType<typeof createPlaylistVideoItemState>;
  readonly panel: ReturnType<typeof createPanelManager>;
  readonly isInBatch: boolean;
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

    const isBatchCompleted = params.isInBatch && (params.itemState.isDone || params.itemState.isLocallyDone);
    const tooltip = isBatchCompleted ? "Download completed" : params.itemState.buttonTooltip;
    const isDisabled = !params.itemState.videoData?.isDownloadable || params.isInProgressInZipBatch;
    const iconName = params.isInProgressInZipBatch ? IconName.CheckCircleThick : params.itemState.downloadIconName;
    sendDownloadButtonData({
      elButton: elDownloadButton,
      buttonId: downloadButtonId,
      tooltip,
      videoData: params.itemState.videoData,
      downloadIconName: iconName,
      isDisabled
    });
  }

  function refreshChevronButton() {
    if (!elChevronButton) {
      return;
    }

    const isDisabled = !params.itemState.videoData?.isDownloadable;
    const iconName = params.panel.isOpen && !params.panel.isPanelBelow
      ? IconName.ExpandLess
      : IconName.ExpandMore;
    sendChevronButtonData({
      elButton: elChevronButton,
      buttonId: chevronButtonId,
      iconName,
      isDisabled
    });
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
    const isHtmlElement = elTarget instanceof HTMLElement;
    if (isHtmlElement) {
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

  function setDownloadButtonElement(elButton: Element) {
    elDownloadButton = elButton;
  }
  function setChevronButtonElement(elButton: Element) {
    elChevronButton = elButton;
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
    get elChevronButton() {
      return elChevronButton;
    },
    attachButtonGroup,
    refreshChevronButton,
    scheduleRefresh,
    attachDownloadButton: (elButton: Element) =>
      attachDownloadButton({
        elButton,
        onClickDownload: onDownloadClick,
        refreshDownload: refreshDownloadButton,
        setDownloadButtonElement
      }),
    attachChevronButton: (elButton: Element) =>
      attachChevronButton({
        elButton,
        onClickChevron: onChevronClick,
        refreshChevron: refreshChevronButton,
        setChevronButtonElement
      })
  };
}
