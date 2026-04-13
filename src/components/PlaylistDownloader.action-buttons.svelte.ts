import { sendButtonData } from "@/lib/polymer-utils";
import {
  ButtonSize,
  ButtonState,
  ButtonStyle,
  ButtonType,
  IconName
} from "@/types";

export const SELECT_ALL_BUTTON_ID = "playlist-select-all-btn";
export const DESELECT_ALL_BUTTON_ID = "playlist-deselect-all-btn";
export const DOWNLOAD_BUTTON_ID = "playlist-download-btn";
export const DOWNLOAD_ALL_BUTTON_ID = "playlist-download-all-btn";

type ActionState = {
  downloadableVideos: { length: number };
  selectedDownloadableVideos: { length: number };
  isAllSelected: boolean;
  isDownloading: boolean;
  isRevealingAll: boolean;
  revealedVideoCount: number;
  downloadButtonLabel: string;
  selectAll(): void;
  clearSelection(): void;
  toggleSelectedDownload(): void;
  revealAndDownloadAll(): Promise<void> | void;
  cancelReveal(): void;
};

export function createPlaylistActionButtons(state: ActionState) {
  let elSelectAll = $state<HTMLElement | null>(null);
  let elDeselectAll = $state<HTMLElement | null>(null);
  let elDownload = $state<HTMLElement | null>(null);
  let elDownloadAll = $state<HTMLElement | null>(null);

  function refreshSelectAll() {
    if (!elSelectAll) {
      return;
    }

    elSelectAll.setAttribute("data-ytdl-button-id", SELECT_ALL_BUTTON_ID);
    const hasAny = state.downloadableVideos.length > 0;
    const isDisabled = !hasAny || state.isAllSelected;
    sendButtonData(elSelectAll, {
      iconName: IconName.None,
      title: "Check all loaded",
      accessibilityText: "Check all loaded",
      style: ButtonStyle.Mono,
      type: ButtonType.Outline,
      buttonSize: ButtonSize.Default,
      state: isDisabled ? ButtonState.Disabled : ButtonState.Active,
      isFullWidth: false,
      isDisabled,
      tooltip: "Check every video currently loaded in this list (scroll down to load more)"
    });
  }

  function refreshDeselectAll() {
    if (!elDeselectAll) {
      return;
    }

    elDeselectAll.setAttribute("data-ytdl-button-id", DESELECT_ALL_BUTTON_ID);
    const hasSelection = state.selectedDownloadableVideos.length > 0;
    sendButtonData(elDeselectAll, {
      iconName: IconName.None,
      title: "Deselect all",
      accessibilityText: "Deselect all",
      style: ButtonStyle.Mono,
      type: ButtonType.Outline,
      buttonSize: ButtonSize.Default,
      state: hasSelection ? ButtonState.Active : ButtonState.Disabled,
      isFullWidth: false,
      isDisabled: !hasSelection,
      tooltip: "Uncheck every video in this list"
    });
  }

  function refreshDownload() {
    if (!elDownload) {
      return;
    }

    elDownload.setAttribute("data-ytdl-button-id", DOWNLOAD_BUTTON_ID);
    const isDisabled = state.selectedDownloadableVideos.length === 0 && !state.isDownloading;
    sendButtonData(elDownload, {
      iconName: state.isDownloading ? IconName.Close : IconName.Download,
      title: state.downloadButtonLabel,
      accessibilityText: state.downloadButtonLabel,
      style: ButtonStyle.Mono,
      type: ButtonType.Tonal,
      buttonSize: ButtonSize.Default,
      state: isDisabled ? ButtonState.Disabled : ButtonState.Active,
      isFullWidth: false,
      isDisabled,
      tooltip: state.downloadButtonLabel
    });
  }

  function refreshDownloadAll() {
    if (!elDownloadAll) {
      return;
    }

    elDownloadAll.setAttribute("data-ytdl-button-id", DOWNLOAD_ALL_BUTTON_ID);
    const isBusy = state.isRevealingAll || state.isDownloading;
    const label = state.isRevealingAll
      ? `Revealing hidden videos (${state.revealedVideoCount})`
      : "Grab the whole playlist";
    const tooltip = state.isRevealingAll
      ? "Stop loading the rest of the playlist"
      : "Scroll through the playlist to reveal any hidden videos, then download every one (ignores the checkboxes)";

    sendButtonData(elDownloadAll, {
      iconName: state.isRevealingAll ? IconName.Close : IconName.PlaylistAdd,
      title: label,
      accessibilityText: label,
      style: ButtonStyle.Mono,
      type: ButtonType.Outline,
      buttonSize: ButtonSize.Default,
      state: isBusy && !state.isRevealingAll ? ButtonState.Disabled : ButtonState.Active,
      isFullWidth: false,
      isDisabled: isBusy && !state.isRevealingAll,
      tooltip
    });
  }

  function attachSelectAll(elButton: Element) {
    if (!(elButton instanceof HTMLElement)) {
      return;
    }

    elButton.setAttribute("data-ytdl-button-id", SELECT_ALL_BUTTON_ID);
    elSelectAll = elButton;
  }

  function attachDeselectAll(elButton: Element) {
    if (!(elButton instanceof HTMLElement)) {
      return;
    }

    elButton.setAttribute("data-ytdl-button-id", DESELECT_ALL_BUTTON_ID);
    elDeselectAll = elButton;
  }

  function attachDownload(elButton: Element) {
    if (!(elButton instanceof HTMLElement)) {
      return;
    }

    elButton.setAttribute("data-ytdl-button-id", DOWNLOAD_BUTTON_ID);
    elDownload = elButton;
  }

  function attachDownloadAll(elButton: Element) {
    if (!(elButton instanceof HTMLElement)) {
      return;
    }

    elButton.setAttribute("data-ytdl-button-id", DOWNLOAD_ALL_BUTTON_ID);
    elDownloadAll = elButton;
  }

  function handleClick(buttonId: string) {
    if (buttonId === DOWNLOAD_BUTTON_ID) {
      state.toggleSelectedDownload();
      return true;
    }

    if (buttonId === DOWNLOAD_ALL_BUTTON_ID) {
      if (state.isRevealingAll) {
        state.cancelReveal();
      } else {
        void state.revealAndDownloadAll();
      }

      return true;
    }

    if (buttonId === SELECT_ALL_BUTTON_ID) {
      state.selectAll();
      return true;
    }

    if (buttonId === DESELECT_ALL_BUTTON_ID) {
      state.clearSelection();
      return true;
    }

    return false;
  }

  return {
    attachSelectAll,
    attachDeselectAll,
    attachDownload,
    attachDownloadAll,
    refreshSelectAll,
    refreshDeselectAll,
    refreshDownload,
    refreshDownloadAll,
    handleClick
  };
}
