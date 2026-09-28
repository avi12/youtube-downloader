import {
  ACTION_BUTTON_IDS,
  buildDeselectAllData,
  buildDownloadAllData,
  buildDownloadData,
  buildStopAllData
} from "./helpers/playlist-action-button-data";
import { attachButton, handleActionButtonClick } from "./helpers/playlist-action-button-handlers";
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
    const isNothingSelected = state.selectedDownloadableVideos.length === 0;
    const isDisabled = isNothingSelected || state.isDownloading;
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
    const isNothingSelectedAndIdle = state.selectedDownloadableVideos.length === 0 && !state.isDownloading;
    const isDisabled = isNothingSelectedAndIdle;
    sendButtonData({
      elButton: elDownload,
      data: buildDownloadData({
        isDisabled,
        isDownloading: state.isDownloading,
        downloadButtonLabel: state.downloadButtonLabel
      })
    });
  }

  function refreshDownloadAll() {
    if (!elDownloadAll) {
      return;
    }

    elDownloadAll.setAttribute(DATA_BUTTON_ID_ATTR, ACTION_BUTTON_IDS.DownloadAll);
    const isIndividualDownloadsPresent = state.activeIndividualDownloadCount > 0;
    const isBusy = state.isRevealingAll || state.isDownloading || isIndividualDownloadsPresent;
    sendButtonData({
      elButton: elDownloadAll,
      data: buildDownloadAllData({
        isBusy,
        isRevealingAll: state.isRevealingAll,
        revealedVideoCount: state.revealedVideoCount
      })
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

  return {
    attachDeselectAll: attachButton({
      buttonId: ACTION_BUTTON_IDS.DeselectAll,
      setter(element) {
        elDeselectAll = element;
      }
    }),
    attachDownload: attachButton({
      buttonId: ACTION_BUTTON_IDS.Download,
      setter(element) {
        elDownload = element;
      }
    }),
    attachDownloadAll: attachButton({
      buttonId: ACTION_BUTTON_IDS.DownloadAll,
      setter(element) {
        elDownloadAll = element;
      }
    }),
    attachStopAll: attachButton({
      buttonId: ACTION_BUTTON_IDS.StopAll,
      setter(element) {
        elStopAll = element;
      }
    }),
    refreshDeselectAll,
    refreshDownload,
    refreshDownloadAll,
    refreshStopAll,
    handleClick: (buttonId: string) => handleActionButtonClick({
      buttonId,
      state
    })
  };
}
