import panelFocusStyles from "./helpers/panel-focus.css?inline";
import { applyInertTrap } from "@/lib/ui/inert-trap";

const POLYMER_DROPDOWN_MENU = "tp-yt-paper-dropdown-menu";
const POLYMER_MENU_BUTTON = "tp-yt-paper-menu-button";
const POLYMER_INPUT = "tp-yt-paper-input";
const POLYMER_IRON_DROPDOWN = "tp-yt-iron-dropdown";
const IRON_OVERLAY_OPENED_EVENT = "iron-overlay-opened";
const IRON_OVERLAY_CLOSED_EVENT = "iron-overlay-closed";
const ATTR_KEYBOARD_FOCUSED = "keyboard-focused";
const ATTR_FOCUSED = "focused";
const PANEL_FIRST_CONTROL_SELECTOR = ".ytdl-panel-body .ytdl-select-trigger";
const FOCUS_IN_EVENT = "focusin";

export function createFocusManager() {
  let removeInert: (() => void) | null = null;

  function release() {
    removeInert?.();
    removeInert = null;
  }

  function attach(elPanel: Element) {
    const isHtmlElement = elPanel instanceof HTMLElement;
    if (!isHtmlElement) {
      return;
    }

    const elFocusStyle = document.createElement("style");
    elFocusStyle.textContent = panelFocusStyles;
    elPanel.append(elFocusStyle);

    for (const elDropdownMenu of elPanel.querySelectorAll(POLYMER_DROPDOWN_MENU)) {
      elDropdownMenu.removeAttribute(ATTR_KEYBOARD_FOCUSED);
      elDropdownMenu.removeAttribute(ATTR_FOCUSED);
      elDropdownMenu.querySelector(POLYMER_MENU_BUTTON)?.removeAttribute(ATTR_FOCUSED);
      elDropdownMenu.querySelector(POLYMER_INPUT)?.removeAttribute(ATTR_FOCUSED);
    }

    const elDropdownRoot = elPanel.closest<HTMLElement>(POLYMER_IRON_DROPDOWN) ?? elPanel;

    elDropdownRoot.addEventListener(IRON_OVERLAY_OPENED_EVENT, e => {
      const isInnerOverlay = e.target !== elDropdownRoot;
      if (isInnerOverlay) {
        return;
      }

      removeInert = applyInertTrap(elDropdownRoot);

      const elFirstControl = elPanel.querySelector<HTMLElement>(PANEL_FIRST_CONTROL_SELECTOR);
      (elFirstControl ?? elPanel).focus();

      elDropdownRoot.addEventListener(IRON_OVERLAY_CLOSED_EVENT, handleOverlayClosed);
    });

    function handleOverlayClosed(e: Event) {
      const isInnerOverlay = e.target !== elDropdownRoot;
      if (isInnerOverlay) {
        return;
      }

      elDropdownRoot.removeEventListener(IRON_OVERLAY_CLOSED_EVENT, handleOverlayClosed);
      release();
    }

    function onFocusIn() {
      for (const elDropdownMenu of elPanel.querySelectorAll(`${POLYMER_DROPDOWN_MENU}[${ATTR_FOCUSED}]`)) {
        const isActiveElementInside = elDropdownMenu.contains(document.activeElement);
        if (isActiveElementInside) {
          continue;
        }

        elDropdownMenu.removeAttribute(ATTR_FOCUSED);
        elDropdownMenu.querySelector(POLYMER_MENU_BUTTON)?.removeAttribute(ATTR_FOCUSED);
        elDropdownMenu.querySelector(POLYMER_INPUT)?.removeAttribute(ATTR_FOCUSED);
      }
    }

    document.addEventListener(FOCUS_IN_EVENT, onFocusIn);

    return () => {
      release();
      document.removeEventListener(FOCUS_IN_EVENT, onFocusIn);
      elFocusStyle.remove();
    };
  }

  return {
    release,
    attach
  };
}
