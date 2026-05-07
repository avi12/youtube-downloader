import panelFocusStyles from "./panel-focus.css?inline";
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

    elDropdownRoot.addEventListener("iron-overlay-opened", () => {
      removeInert = applyInertTrap(elDropdownRoot);

      // Focus the first input after the overlay opens so it's visible and focusable.
      const elInitialFocus = elPanel.querySelector<HTMLElement>("tp-yt-paper-input:not([disabled])");
      elInitialFocus?.focus();

      // Polymer's receivedFocusFromKeyboard may not be initialized yet at open time, so set the attribute directly.
      elInitialFocus?.closest("tp-yt-paper-dropdown-menu")?.setAttribute("keyboard-focused", "");

      // Release the inert trap when Polymer closes the overlay externally
      // (click-outside or Escape) since closePanel() only handles explicit close.
      elDropdownRoot.addEventListener("iron-overlay-closed", release, { once: true });
    });

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
