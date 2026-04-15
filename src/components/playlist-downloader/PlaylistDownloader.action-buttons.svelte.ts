import { sendButtonData } from "@/lib/ui/polymer-utils";
import {
  ButtonSize,
  ButtonState,
  ButtonStyle,
  ButtonType,
  IconName
} from "@/types";

export const DESELECT_ALL_BUTTON_ID = "playlist-deselect-all-btn";
export const DOWNLOAD_BUTTON_ID = "playlist-download-btn";
export const DOWNLOAD_ALL_BUTTON_ID = "playlist-download-all-btn";

export function createPlaylistActionButtons(state: {
  selectedDownloadableVideos: {
    length: number;
  };
  isDownloading: boolean;
  isRevealingAll: boolean;
  revealedVideoCount: number;
  downloadButtonLabel: string;
  activeIndividualDownloadCount: number;
  clearSelection(): void;
  toggleSelectedDownload(): void;
  revealAndDownloadAll(): Promise<void> | void;
  cancelReveal(): void;
}) {
  let elDeselectAll = $state<HTMLElement | null>(null);
  let elDownload = $state<HTMLElement | null>(null);
  let elDownloadAll = $state<HTMLElement | null>(null);

  function refreshDeselectAll() {
    if (!elDeselectAll) {
      return;
    }

    elDeselectAll.setAttribute("data-ytdl-button-id", DESELECT_ALL_BUTTON_ID);
    const isDisabled = state.selectedDownloadableVideos.length === 0 || state.isDownloading;
    sendButtonData({
      elButton: elDeselectAll,
      data: {
        iconName: IconName.None,
        title: "Deselect all",
        accessibilityText: "Deselect all",
        style: ButtonStyle.Mono,
        type: ButtonType.Outline,
        buttonSize: ButtonSize.Default,
        state: isDisabled ? ButtonState.Disabled : ButtonState.Active,
        isFullWidth: false,
        isDisabled,
        tooltip: "Deselect all"
      }
    });
  }

  function refreshDownload() {
    if (!elDownload) {
      return;
    }

    elDownload.setAttribute("data-ytdl-button-id", DOWNLOAD_BUTTON_ID);
    const isDisabled = state.selectedDownloadableVideos.length === 0 && !state.isDownloading;
    sendButtonData({
      elButton: elDownload,
      data: {
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
      }
    });
  }

  function refreshDownloadAll() {
    if (!elDownloadAll) {
      return;
    }

    elDownloadAll.setAttribute("data-ytdl-button-id", DOWNLOAD_ALL_BUTTON_ID);
    const isBusy = state.isRevealingAll || state.isDownloading || state.activeIndividualDownloadCount > 0;
    const label = state.isRevealingAll
      ? `Revealing hidden videos (${state.revealedVideoCount})`
      : "Grab the whole playlist";
    const tooltip = state.isRevealingAll
      ? "Stop revealing"
      : "Reveal all videos and download";

    sendButtonData({
      elButton: elDownloadAll,
      data: {
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
      }
    });
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
    if (buttonId === DESELECT_ALL_BUTTON_ID) {
      state.clearSelection();
      return true;
    }

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

    return false;
  }

  return {
    attachDeselectAll,
    attachDownload,
    attachDownloadAll,
    refreshDeselectAll,
    refreshDownload,
    refreshDownloadAll,
    handleClick
  };
}
