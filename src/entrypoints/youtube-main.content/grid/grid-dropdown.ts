import { registerDropdownFocusHandlers } from "./grid-dropdown-focus";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";
import type { TpYtIronDropdownElement } from "@/types";

const gridDropdowns = new Map<string, TpYtIronDropdownElement>();

function createGridDropdown({ contentId, positionTargetSelector }: {
  contentId: string;
  positionTargetSelector: string;
}) {
  const elPositionTarget = document.querySelector(positionTargetSelector);
  if (!elPositionTarget) {
    return;
  }

  const existingDropdown = gridDropdowns.get(contentId);
  if (existingDropdown) {
    existingDropdown.close();
    existingDropdown.remove();
    gridDropdowns.delete(contentId);
  }

  const elDropdownContentSlot = document.createElement("ytd-menu-popup-renderer");
  elDropdownContentSlot.slot = "dropdown-content";
  elDropdownContentSlot.id = contentId;

  const elDropdown = document.createElement("tp-yt-iron-dropdown");
  elDropdown.append(elDropdownContentSlot);

  const elPopupContainer = document.querySelector("ytd-popup-container") ?? document.body;
  elPopupContainer.append(elDropdown);

  elDropdown.positionTarget = elPositionTarget;
  elDropdown.horizontalAlign = "left";
  elDropdown.verticalAlign = "top";
  elDropdown.noOverlap = true;
  elDropdown.dynamicAlign = true;
  elDropdown.allowOutsideScroll = false;
  elDropdown.restoreFocusOnClose = false;

  const resizeObserver = new ResizeObserver(() => {
    if (elDropdown.opened) {
      elDropdown.refit();
    }
  });

  resizeObserver.observe(elDropdownContentSlot);
  gridDropdowns.set(contentId, elDropdown);

  // Opening after a frame lets Polymer finish initialization.
  void crossWorldMessenger.sendMessage(CrossWorldMessage.DropdownReady, { contentId });
  requestAnimationFrame(() => elDropdown.open());
}

function closeGridDropdown(videoId: string) {
  const contentId = `ytdl-grid-panel-${videoId}`;
  const elDropdown = gridDropdowns.get(contentId);
  if (elDropdown) {
    elDropdown.close();
    elDropdown.remove();
    gridDropdowns.delete(contentId);
  }
}

export function registerGridDropdownHandlers() {
  crossWorldMessenger.onMessage(CrossWorldMessage.CreateDropdown, ({ data }) => {
    createGridDropdown({
      contentId: data.contentId,
      positionTargetSelector: data.positionTargetSelector
    });
  });
  crossWorldMessenger.onMessage(CrossWorldMessage.CloseDropdown, ({ data }) => {
    closeGridDropdown(data.videoId);
  });
  registerDropdownFocusHandlers();
}
