import { ACTION_BUTTON_IDS } from "./playlist-action-button-data";
import { DATA_BUTTON_ID_ATTR } from "@/lib/ui/polymer-utils";

type AttachButtonParams = {
  buttonId: string;
  setter: (el: HTMLElement) => void;
};
export function attachButton({ buttonId, setter }: AttachButtonParams) {
  return (elButton: Element) => {
    const isHtmlElement = elButton instanceof HTMLElement;
    if (!isHtmlElement) {
      return;
    }

    elButton.setAttribute(DATA_BUTTON_ID_ATTR, buttonId);
    setter(elButton);
  };
}

type HandleActionButtonClickParams = {
  buttonId: string;
  state: {
    isRevealingAll: boolean;
    clearSelection(): void;
    toggleSelectedDownload(): void;
    revealAndDownloadAll(): Promise<void> | void;
    cancelReveal(): void;
  };
};
export function handleActionButtonClick({ buttonId, state }: HandleActionButtonClickParams) {
  const isDeselectAll = buttonId === ACTION_BUTTON_IDS.DeselectAll;
  if (isDeselectAll) {
    state.clearSelection();
    return true;
  }

  const isDownloadOrStop = buttonId === ACTION_BUTTON_IDS.Download || buttonId === ACTION_BUTTON_IDS.StopAll;
  if (isDownloadOrStop) {
    state.toggleSelectedDownload();
    return true;
  }

  const isDownloadAll = buttonId === ACTION_BUTTON_IDS.DownloadAll;
  if (isDownloadAll) {
    if (state.isRevealingAll) {
      state.cancelReveal();
    } else {
      void state.revealAndDownloadAll();
    }

    return true;
  }

  return false;
}
