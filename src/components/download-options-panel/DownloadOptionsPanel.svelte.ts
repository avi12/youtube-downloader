import { CrossWorldMessage, crossWorldMessenger, onButtonClick } from "@/lib/messaging/cross-world-messenger";
import { PrimaryButtonState } from "@/lib/ui/panel-button-attachments.svelte";

export const HEADER_CLOSE_BUTTON_ID = "ytdl-panel-header-close";
export const PRIMARY_BUTTON_ID = "ytdl-panel-primary";
export const VIEW_BUTTON_ID = "ytdl-panel-view";

export interface PanelActions {
  readonly primaryState: PrimaryButtonState;
  cancelDownload(): void;
  resumeDownload(): void;
  startDownload(): void;
  revealDownload(): void;
}

export function setupPanelButtonHandler(panel: PanelActions, onClose: () => void) {
  return onButtonClick(buttonId => {
    if (buttonId === HEADER_CLOSE_BUTTON_ID) {
      onClose();
      return;
    }

    if (buttonId === PRIMARY_BUTTON_ID) {
      if (panel.primaryState === PrimaryButtonState.Downloading) {
        panel.cancelDownload();
      } else if (panel.primaryState === PrimaryButtonState.Interrupted) {
        panel.resumeDownload();
      } else {
        panel.startDownload();
      }

      return;
    }

    if (buttonId === VIEW_BUTTON_ID) {
      panel.revealDownload();
    }
  });
}

export function sendPanelClosed() {
  void crossWorldMessenger.sendMessage(CrossWorldMessage.PanelClosed);
  document.dispatchEvent(new CustomEvent("ytdl:panel-closed"));
}

const YT_PLAYER_KEYS = new Set([" ", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);

export function handlePanelKeydown(onClose: () => void) {
  return (e: KeyboardEvent) => {
    if (e.key === "Escape" && !document.querySelector(":popover-open")) {
      onClose();
    }

    if (YT_PLAYER_KEYS.has(e.key)) {
      e.stopPropagation();
    }
  };
}
