import {
  ACTION_BUTTON_IDS,
  buildDeselectAllData,
  buildDownloadAllData,
  buildDownloadData,
  buildStopAllData
} from "./playlist-action-button-data";
import { DATA_BUTTON_ID_ATTR, sendButtonData } from "@/lib/ui/polymer-utils";

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

    elDeselectAll.setAttribute(DATA_BUTTON_ID_ATTR, ACTION_BUTTON_IDS.DeselectAll);
    const isDisabled = state.selectedDownloadableVideos.length === 0 || state.isDownloading;
    sendButtonData({
      elButton: elDeselectAll,
      data: buildDeselectAllData(isDisabled)
    });
  }

  function refreshDownload() {
    if (!elDownload) {
      return;
    }

    elDownload.setAttribute(DATA_BUTTON_ID_ATTR, ACTION_BUTTON_IDS.Download);
    const isDisabled = state.selectedDownloadableVideos.length === 0 && !state.isDownloading;
    sendButtonData({
      elButton: elDownload,
      data: buildDownloadData(isDisabled, state.isDownloading, state.downloadButtonLabel)
    });
  }

  function refreshDownloadAll() {
    if (!elDownloadAll) {
      return;
    }

    elDownloadAll.setAttribute(DATA_BUTTON_ID_ATTR, ACTION_BUTTON_IDS.DownloadAll);
    const isBusy = state.isRevealingAll || state.isDownloading || state.activeIndividualDownloadCount > 0;
    sendButtonData({
      elButton: elDownloadAll,
      data: buildDownloadAllData(isBusy, state.isRevealingAll, state.revealedVideoCount)
    });
  }

  function refreshStopAll() {
    if (!elStopAll) {
      return;
    }

    elStopAll.setAttribute(DATA_BUTTON_ID_ATTR, ACTION_BUTTON_IDS.StopAll);
    sendButtonData({
      elButton: elStopAll,
      data: buildStopAllData()
    });
  }

  function attachButton(buttonId: string, setter: (el: HTMLElement) => void) {
    return (elButton: Element) => {
      if (!(elButton instanceof HTMLElement)) {
        return;
      }

      elButton.setAttribute(DATA_BUTTON_ID_ATTR, buttonId);
      setter(elButton);
    };
  }

  function handleClick(buttonId: string) {
    if (buttonId === ACTION_BUTTON_IDS.DeselectAll) {
      state.clearSelection();
      return true;
    }

    if (buttonId === ACTION_BUTTON_IDS.Download || buttonId === ACTION_BUTTON_IDS.StopAll) {
      state.toggleSelectedDownload();
      return true;
    }

    if (buttonId === ACTION_BUTTON_IDS.DownloadAll) {
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
    attachDeselectAll: attachButton(ACTION_BUTTON_IDS.DeselectAll, element => {
      elDeselectAll = element;
    }),
    attachDownload: attachButton(ACTION_BUTTON_IDS.Download, element => {
      elDownload = element;
    }),
    attachDownloadAll: attachButton(ACTION_BUTTON_IDS.DownloadAll, element => {
      elDownloadAll = element;
    }),
    attachStopAll: attachButton(ACTION_BUTTON_IDS.StopAll, element => {
      elStopAll = element;
    }),
    refreshDeselectAll,
    refreshDownload,
    refreshDownloadAll,
    refreshStopAll,
    handleClick
  };
}
