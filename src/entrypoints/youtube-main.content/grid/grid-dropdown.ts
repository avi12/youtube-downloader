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

  // ytd-menu-popup-renderer carries role="menu" from YouTube's own element definition.
  // Our panel is a dialog, not a menu - override to presentation and hide the empty
  // Polymer listbox from assistive technologies (WCAG 4.1.2, 1.3.1).
  requestAnimationFrame(() => {
    elDropdownContentSlot.setAttribute("role", "presentation");
    elDropdownContentSlot.querySelector("tp-yt-paper-listbox")?.setAttribute("aria-hidden", "true");
  });

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

// Polymer's IronFocusedBehavior doesn't reflect keyboard vs pointer focus to an attribute;
// bridge it to [keyboard-focused] so CSS can gate the focus ring (WCAG 2.4.7).
function handleDropdownFocusIn(e: FocusEvent) {
  if (!(e.target instanceof Element)) {
    return;
  }

  const elDropdown = e.target.closest("tp-yt-paper-dropdown-menu");
  if (!elDropdown) {
    return;
  }

  if (elDropdown.receivedFocusFromKeyboard) {
    elDropdown.setAttribute("keyboard-focused", "");
  }
}

function handleDropdownFocusOut(e: FocusEvent) {
  if (!(e.target instanceof Element)) {
    return;
  }

  const elDropdown = e.target.closest("tp-yt-paper-dropdown-menu");
  if (!elDropdown) {
    return;
  }

  requestAnimationFrame(() => {
    if (!elDropdown.contains(document.activeElement)) {
      elDropdown.removeAttribute("keyboard-focused");
    }
  });
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
  document.addEventListener("focusin", handleDropdownFocusIn);
  document.addEventListener("focusout", handleDropdownFocusOut);
}
