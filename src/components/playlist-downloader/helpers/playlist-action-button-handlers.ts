import { ACTION_BUTTON_IDS } from "./playlist-action-button-data";
import { DATA_BUTTON_ID_ATTR } from "@/lib/ui/polymer-utils";

export function attachButton(buttonId: string, setter: (el: HTMLElement) => void) {
  return (elButton: Element) => {
    if (!(elButton instanceof HTMLElement)) {
      return;
    }

    elButton.setAttribute(DATA_BUTTON_ID_ATTR, buttonId);
    setter(elButton);
  };
}

export function handleActionButtonClick(buttonId: string, state: {
  isRevealingAll: boolean;
  clearSelection(): void;
  toggleSelectedDownload(): void;
  revealAndDownloadAll(): Promise<void> | void;
  cancelReveal(): void;
}) {
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
