import { SYNC_NAMESPACE, SyncKey } from "@/lib/synced-stores.svelte";
import { type TpYtIronDropdownElement } from "@/types";

const gridDropdowns = new Map<string, TpYtIronDropdownElement>();

function handleCreateDropdown(e: MessageEvent) {
  if (e.data?.namespace !== SYNC_NAMESPACE || e.data.key !== SyncKey.CreateDropdown) {
    return;
  }

  const { contentId, positionTargetSelector } = e.data.value;
  const elPositionTarget = document.querySelector(positionTargetSelector);
  if (!elPositionTarget) {
    return;
  }

  // Clean up any existing dropdown for this content ID (from a previous open)
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

  // Refit the dropdown when panel content changes size (e.g. progress bar appears)
  const resizeObserver = new ResizeObserver(() => {
    if (elDropdown.opened) {
      elDropdown.refit();
    }
  });

  resizeObserver.observe(elDropdownContentSlot);
  gridDropdowns.set(contentId, elDropdown);

  // Notify the isolated world that the dropdown is ready, then open it.
  // Opening after a frame lets Polymer finish initialization.
  postMessage({
    namespace: SYNC_NAMESPACE,
    key: SyncKey.DropdownReady,
    value: { contentId }
  }, location.origin);
  requestAnimationFrame(() => elDropdown.open());
}

function handleCloseDropdown(e: MessageEvent) {
  if (e.data?.namespace !== SYNC_NAMESPACE || e.data.key !== SyncKey.CloseDropdown) {
    return;
  }

  const { videoId: dropdownVideoId } = e.data.value;
  const contentId = `ytdl-grid-panel-${dropdownVideoId}`;
  const elDropdown = gridDropdowns.get(contentId);
  if (elDropdown) {
    elDropdown.close();
    elDropdown.remove();
    gridDropdowns.delete(contentId);
  }
}

// Polymer's IronFocusedBehavior tracks keyboard vs pointer focus via
// receivedFocusFromKeyboard, but it doesn't reflect to an attribute.
// Bridge it to a [keyboard-focused] attribute so CSS in the isolated world
// can show a focus ring only for keyboard users (WCAG 2.4.7).
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
  addEventListener("message", handleCreateDropdown);
  addEventListener("message", handleCloseDropdown);
  document.addEventListener("focusin", handleDropdownFocusIn);
  document.addEventListener("focusout", handleDropdownFocusOut);
}
