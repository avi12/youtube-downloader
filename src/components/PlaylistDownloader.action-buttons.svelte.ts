import { sendButtonData } from "@/lib/polymer-utils";
import {
  ButtonSize,
  ButtonState,
  ButtonStyle,
  ButtonType,
  IconName
} from "@/types";

export const SELECT_ALL_BUTTON_ID = "playlist-select-all-btn";
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
  let elDownload = $state<HTMLElement | null>(null);
  let elDownloadAll = $state<HTMLElement | null>(null);

  function refreshSelectAll() {
    if (!elSelectAll) {
      return;
    }

    const hasAny = state.downloadableVideos.length > 0;
    const label = state.isAllSelected ? "Clear selection" : "Check all loaded";
    const tooltip = state.isAllSelected
      ? "Uncheck every video in this list"
      : "Check every video currently loaded in this list (scroll down to load more)";
    sendButtonData(elSelectAll, {
      iconName: IconName.None,
      title: label,
      accessibilityText: label,
      style: ButtonStyle.Mono,
      type: state.isAllSelected ? ButtonType.Tonal : ButtonType.Outline,
      buttonSize: ButtonSize.Default,
      state: hasAny ? ButtonState.Active : ButtonState.Disabled,
      isFullWidth: false,
      isDisabled: !hasAny,
      tooltip
    });
  }

  function refreshDownload() {
    if (!elDownload) {
      return;
    }

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
      if (state.isAllSelected) {
        state.clearSelection();
      } else {
        state.selectAll();
      }

      return true;
    }

    return false;
  }

  return {
    attachSelectAll,
    attachDownload,
    attachDownloadAll,
    refreshSelectAll,
    refreshDownload,
    refreshDownloadAll,
    handleClick
  };
}
