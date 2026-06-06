import { CrossWorldMessage, crossWorldMessenger, onButtonClick } from "@/lib/messaging/cross-world-messenger";
import { PrimaryButtonState } from "@/lib/ui/panel-button-attachments.svelte";
import type { Prettify } from "@/types";

export const HEADER_CLOSE_BUTTON_ID = "ytdl-panel-header-close";
export const PRIMARY_BUTTON_ID = "ytdl-panel-primary";
export const VIEW_BUTTON_ID = "ytdl-panel-view";

export type PanelActions = Prettify<{
  readonly primaryState: PrimaryButtonState;
  cancelDownload(): void;
  resumeDownload(): void;
  startDownload(): void;
  revealDownload(): void;
}>;

type SetupPanelButtonHandlerParams = Prettify<{
  panel: PanelActions;
  onClose: () => void;
}>;
export function setupPanelButtonHandler({ panel, onClose }: SetupPanelButtonHandlerParams) {
  return onButtonClick(buttonId => {
    const isCloseButton = buttonId === HEADER_CLOSE_BUTTON_ID;
    if (isCloseButton) {
      onClose();
      return;
    }

    const isPrimaryButton = buttonId === PRIMARY_BUTTON_ID;
    if (isPrimaryButton) {
      const isDownloading = panel.primaryState === PrimaryButtonState.Downloading;
      const isInterrupted = panel.primaryState === PrimaryButtonState.Interrupted;
      queueMicrotask(() => {
        if (isDownloading) {
          panel.cancelDownload();
        } else if (isInterrupted) {
          panel.resumeDownload();
        } else {
          panel.startDownload();
        }
      });
      return;
    }

    const isViewButton = buttonId === VIEW_BUTTON_ID;
    if (isViewButton) {
      panel.revealDownload();
    }
  });
}

export const PANEL_CLOSED_EVENT = "ytdl:panel-closed";

export function sendPanelClosed() {
  crossWorldMessenger.sendMessage(CrossWorldMessage.PanelClosed).catch(() => {});
  document.dispatchEvent(new CustomEvent(PANEL_CLOSED_EVENT));
}

const YT_PLAYER_KEYS = new Set([" ", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);

export function handlePanelKeydown(onClose: () => void) {
  return (e: KeyboardEvent) => {
    const isEscape = e.key === "Escape";
    const isEscapeWithNoPopover = isEscape && !document.querySelector(":popover-open");
    if (isEscapeWithNoPopover) {
      onClose();
    }

    const isYtPlayerKey = YT_PLAYER_KEYS.has(e.key);
    if (isYtPlayerKey) {
      e.stopPropagation();
    }
  };
}
