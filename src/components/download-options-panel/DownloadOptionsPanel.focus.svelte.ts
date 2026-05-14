import panelFocusStyles from "./helpers/panel-focus.css?inline";
import { applyInertTrap } from "@/lib/ui/inert-trap";

export function createFocusManager() {
  let removeInert: (() => void) | null = null;

  function release() {
    removeInert?.();
    removeInert = null;
  }

  function attach(elPanel: Element) {
    if (!(elPanel instanceof HTMLElement)) {
      return;
    }

    const elFocusStyle = document.createElement("style");
    elFocusStyle.textContent = panelFocusStyles;
    elPanel.append(elFocusStyle);

    for (const elDropdownMenu of elPanel.querySelectorAll("tp-yt-paper-dropdown-menu")) {
      elDropdownMenu.removeAttribute("keyboard-focused");
      elDropdownMenu.removeAttribute("focused");
      elDropdownMenu.querySelector("tp-yt-paper-menu-button")?.removeAttribute("focused");
      elDropdownMenu.querySelector("tp-yt-paper-input")?.removeAttribute("focused");
    }

    // Applying the inert trap before open() interferes with Polymer's overlay mechanics.
    const elDropdownRoot = elPanel.closest<HTMLElement>("tp-yt-iron-dropdown") ?? elPanel;

    elDropdownRoot.addEventListener("iron-overlay-opened", e => {
      // Inner paper-menu-button overlays bubble iron-overlay-opened up to here.
      // Only respond when the panel's own dropdown opens, otherwise the saved
      // removeInert gets overwritten and the first trap never releases - leaving
      // the rest of the page permanently inert.
      if (e.target !== elDropdownRoot) {
        return;
      }

      removeInert = applyInertTrap(elDropdownRoot);

      // Focus the first form control so Tab from here moves forward through
      // the controls, not to the close button which is earlier in DOM order.
      const elFirstControl = elPanel.querySelector<HTMLElement>(".ytdl-panel-body .ytdl-select-trigger");
      (elFirstControl ?? elPanel).focus();

      // Release the inert trap when Polymer closes the overlay externally
      // (click-outside or Escape) since closePanel() only handles explicit close.
      elDropdownRoot.addEventListener("iron-overlay-closed", handleOverlayClosed);
    });

    function handleOverlayClosed(e: Event) {
      if (e.target !== elDropdownRoot) {
        return;
      }

      elDropdownRoot.removeEventListener("iron-overlay-closed", handleOverlayClosed);
      release();
    }

    // Polymer's IronFocusedBehavior doesn't always clear the focused attribute
    // from sibling dropdowns when Tab moves between them.
    function onFocusIn() {
      for (const elDropdownMenu of elPanel.querySelectorAll("tp-yt-paper-dropdown-menu[focused]")) {
        if (elDropdownMenu.contains(document.activeElement)) {
          continue;
        }

        elDropdownMenu.removeAttribute("focused");
        elDropdownMenu.querySelector("tp-yt-paper-menu-button")?.removeAttribute("focused");
        elDropdownMenu.querySelector("tp-yt-paper-input")?.removeAttribute("focused");
      }
    }

    document.addEventListener("focusin", onFocusIn);

    return () => {
      release();
      document.removeEventListener("focusin", onFocusIn);
      elFocusStyle.remove();
    };
  }

  return {
    release,
    attach
  };
}
