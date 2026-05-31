import { buildPlaylistChevronButtonId, buildPlaylistDownloadButtonId } from "./helpers/playlist-grid-panel-lifecycle";
import type { createPanelManager } from "./PlaylistGridItem.panel.svelte";
import { PlaylistGridStatus, type createPlaylistGridItemState } from "./PlaylistGridItem.state.svelte";
import {
  sendChevronButtonData,
  sendDownloadButtonData
} from "@/components/playlist-downloader/video-item/PlaylistVideoItem.button-data";
import {
  attachChevronButton as attachChevronButtonElement,
  attachDownloadButton as attachDownloadButtonElement
} from "@/components/playlist-downloader/video-item/PlaylistVideoItem.buttons.attach";
import { IconName } from "@/types";

const BUTTON_REFRESH_INTERVAL_MS = 250;

type CreateButtonManagerParams = {
  playlistId: string;
  state: ReturnType<typeof createPlaylistGridItemState>;
  panel: ReturnType<typeof createPanelManager>;
};
export function createButtonManager({ playlistId, state, panel }: CreateButtonManagerParams) {
  let elDownloadButton: Element | null = null;
  let elChevronButton: Element | null = null;
  let buttonRefreshTimer: ReturnType<typeof setTimeout> | null = null;

  const downloadButtonId = buildPlaylistDownloadButtonId(playlistId);
  const chevronButtonId = buildPlaylistChevronButtonId(playlistId);

  function resolveDownloadIcon() {
    if (state.isWorking) {
      return IconName.Close;
    }

    if (state.status === PlaylistGridStatus.Done) {
      return IconName.CheckCircleThick;
    }

    return IconName.Download;
  }

  function resolveTooltip() {
    if (state.status === PlaylistGridStatus.Fetching) {
      return "Cancel";
    }

    if (state.status === PlaylistGridStatus.Loading) {
      return "Cancel";
    }

    if (state.status === PlaylistGridStatus.Downloading) {
      return "Cancel";
    }

    if (state.status === PlaylistGridStatus.Done) {
      return "Playlist downloaded";
    }

    if (state.status === PlaylistGridStatus.Failed) {
      return state.errorMessage || "Retry download";
    }

    return "Download playlist";
  }

  function refreshDownloadButton() {
    if (!elDownloadButton) {
      return;
    }

    const tooltip = resolveTooltip();
    sendDownloadButtonData({
      elButton: elDownloadButton,
      buttonId: downloadButtonId,
      tooltip,
      videoData: null,
      downloadIconName: resolveDownloadIcon(),
      isDisabled: false
    });
  }

  function refreshChevronButton() {
    if (!elChevronButton) {
      return;
    }

    const isPanelOpenAbove = panel.isOpen && !panel.isPanelBelow;
    const iconName = isPanelOpenAbove ? IconName.ExpandLess : IconName.ExpandMore;
    sendChevronButtonData({
      elButton: elChevronButton,
      buttonId: chevronButtonId,
      iconName,
      isDisabled: false
    });
  }

  function scheduleRefresh() {
    if (buttonRefreshTimer) {
      return;
    }

    queueMicrotask(() => {
      refreshDownloadButton();
      refreshChevronButton();
    });
    buttonRefreshTimer = setTimeout(() => {
      buttonRefreshTimer = null;
    }, BUTTON_REFRESH_INTERVAL_MS);
  }

  function onDownloadClick() {
    queueMicrotask(() => state.handlePrimaryClick());
  }

  function onChevronClick() {
    queueMicrotask(() => {
      panel.toggle();
      refreshChevronButton();
    });
  }

  function setDownloadButtonElement(element: Element) {
    elDownloadButton = element;
  }

  function setChevronButtonElement(element: Element) {
    elChevronButton = element;
  }

  return {
    get elChevronButton() {
      return elChevronButton;
    },
    refreshChevronButton,
    scheduleRefresh,
    attachDownloadButton: (elButton: Element) =>
      attachDownloadButtonElement({
        elButton,
        buttonId: downloadButtonId,
        onClickDownload: onDownloadClick,
        refreshDownload: refreshDownloadButton,
        setDownloadButtonElement
      }),
    attachChevronButton: (elButton: Element) =>
      attachChevronButtonElement({
        elButton,
        buttonId: chevronButtonId,
        onClickChevron: onChevronClick,
        refreshChevron: refreshChevronButton,
        setChevronButtonElement
      })
  };
}
