import { DATA_BUTTON_ID_ATTR, sendButtonData } from "@/lib/ui/polymer-utils";
import {
  ButtonSize,
  ButtonState,
  ButtonStyle,
  ButtonType,
  IconName
} from "@/types";

const ButtonId = {
  DeselectAll: "playlist-deselect-all-btn",
  Download: "playlist-download-btn",
  DownloadAll: "playlist-download-all-btn",
  StopAll: "playlist-stop-all-btn"
} as const;

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
  let elStopAll = $state<HTMLElement | null>(null);

  function refreshDeselectAll() {
    if (!elDeselectAll) {
      return;
    }

    elDeselectAll.setAttribute(DATA_BUTTON_ID_ATTR, ButtonId.DeselectAll);
    const isDisabled = state.selectedDownloadableVideos.length === 0 || state.isDownloading;
    sendButtonData({
      elButton: elDeselectAll,
      data: {
        iconName: IconName.Close,
        title: "Clear",
        accessibilityText: "Clear selection",
        style: ButtonStyle.Mono,
        type: ButtonType.Text,
        buttonSize: ButtonSize.XSmall,
        state: isDisabled ? ButtonState.Disabled : ButtonState.Active,
        isFullWidth: false,
        isDisabled,
        tooltip: "Clear selection"
      }
    });
  }

  function refreshDownload() {
    if (!elDownload) {
      return;
    }

    elDownload.setAttribute(DATA_BUTTON_ID_ATTR, ButtonId.Download);
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

    elDownloadAll.setAttribute(DATA_BUTTON_ID_ATTR, ButtonId.DownloadAll);
    const isBusy = state.isRevealingAll || state.isDownloading || state.activeIndividualDownloadCount > 0;
    const label = state.isRevealingAll
      ? `Revealing hidden videos (${state.revealedVideoCount})`
      : "Download whole playlist";
    const tooltip = state.isRevealingAll
      ? "Stop revealing"
      : "Reveal all videos and download";

    sendButtonData({
      elButton: elDownloadAll,
      data: {
        iconName: state.isRevealingAll ? IconName.Close : IconName.Download,
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

  function refreshStopAll() {
    if (!elStopAll) {
      return;
    }

    elStopAll.setAttribute(DATA_BUTTON_ID_ATTR, ButtonId.StopAll);
    sendButtonData({
      elButton: elStopAll,
      data: {
        iconName: IconName.Stop,
        title: "Stop all",
        accessibilityText: "Stop all downloads",
        style: ButtonStyle.Mono,
        type: ButtonType.Text,
        buttonSize: ButtonSize.Default,
        state: ButtonState.Active,
        isFullWidth: false,
        isDisabled: false,
        tooltip: "Stop all downloads"
      }
    });
  }

  function attachStopAll(elButton: Element) {
    if (!(elButton instanceof HTMLElement)) {
      return;
    }

    elButton.setAttribute(DATA_BUTTON_ID_ATTR, ButtonId.StopAll);
    elStopAll = elButton;
  }

  function attachDeselectAll(elButton: Element) {
    if (!(elButton instanceof HTMLElement)) {
      return;
    }

    elButton.setAttribute(DATA_BUTTON_ID_ATTR, ButtonId.DeselectAll);
    elDeselectAll = elButton;
  }

  function attachDownload(elButton: Element) {
    if (!(elButton instanceof HTMLElement)) {
      return;
    }

    elButton.setAttribute(DATA_BUTTON_ID_ATTR, ButtonId.Download);
    elDownload = elButton;
  }

  function attachDownloadAll(elButton: Element) {
    if (!(elButton instanceof HTMLElement)) {
      return;
    }

    elButton.setAttribute(DATA_BUTTON_ID_ATTR, ButtonId.DownloadAll);
    elDownloadAll = elButton;
  }

  function handleClick(buttonId: string) {
    if (buttonId === ButtonId.DeselectAll) {
      state.clearSelection();
      return true;
    }

    if (buttonId === ButtonId.Download) {
      state.toggleSelectedDownload();
      return true;
    }

    if (buttonId === ButtonId.StopAll) {
      state.toggleSelectedDownload();
      return true;
    }

    if (buttonId === ButtonId.DownloadAll) {
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
    attachStopAll,
    refreshDeselectAll,
    refreshDownload,
    refreshDownloadAll,
    refreshStopAll,
    handleClick
  };
}
