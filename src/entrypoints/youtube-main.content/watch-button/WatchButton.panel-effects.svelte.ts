import type { TpYtIronDropdownElement, YtButtonViewModelElement } from "@/types";

const PANEL_VIEWPORT_MARGIN = 16;

export function createPanelEffects({
  getElChevronButton,
  getElDropdown,
  getIsPanelOpen,
  getIsPanelBelow,
  setIsPanelOpen,
  setIsPanelBelow
}: {
  getElChevronButton: () => YtButtonViewModelElement | null;
  getElDropdown: () => TpYtIronDropdownElement;
  getIsPanelOpen: () => boolean;
  getIsPanelBelow: () => boolean;
  setIsPanelOpen: (value: boolean) => void;
  setIsPanelBelow: (value: boolean) => void;
}) {
  function applyPanelPositioning() {
    const elDropdown = getElDropdown();
    const chevronRect = getElChevronButton()?.getBoundingClientRect();
    if (!chevronRect) {
      return;
    }

    const spaceAbove = chevronRect.top;
    const spaceBelow = innerHeight - chevronRect.bottom;
    const isPanelBelow = spaceBelow >= spaceAbove;
    if (isPanelBelow) {
      elDropdown.setAttribute("data-ytdl-panel-position", "below");
      elDropdown.style.setProperty("--ytdl-panel-top-distance", `${chevronRect.bottom}px`);
      elDropdown.style.setProperty("--ytdl-panel-max-height", `${spaceBelow - PANEL_VIEWPORT_MARGIN}px`);
      elDropdown.style.removeProperty("--ytdl-panel-bottom-distance");
    } else {
      elDropdown.setAttribute("data-ytdl-panel-position", "above");
      elDropdown.style.setProperty("--ytdl-panel-bottom-distance", `${innerHeight - chevronRect.top}px`);
      elDropdown.style.setProperty("--ytdl-panel-max-height", `${spaceAbove - PANEL_VIEWPORT_MARGIN}px`);
      elDropdown.style.removeProperty("--ytdl-panel-top-distance");
    }

    setIsPanelBelow(isPanelBelow);
  }

  $effect(() => {
    const elSlot = getElDropdown().querySelector<HTMLElement>("[data-ytdl-panel-slot]");
    elSlot?.style.setProperty("--ytdl-panel-origin", getIsPanelBelow() ? "top" : "bottom");
  });

  $effect(() => {
    const elDropdown = getElDropdown();

    function handleDropdownOpened(e: Event) {
      const isOtherTarget = e.target !== elDropdown;
      if (isOtherTarget) {
        return;
      }

      applyPanelPositioning();
    }

    function handleDropdownClosed() {
      const isPanelClosed = !getIsPanelOpen();
      if (isPanelClosed) {
        return;
      }

      setIsPanelOpen(false);
      getElChevronButton()?.querySelector<HTMLButtonElement>("button")?.focus();
    }

    function handleWindowResize() {
      applyPanelPositioning();
    }

    elDropdown.addEventListener("iron-overlay-opened", handleDropdownOpened);
    elDropdown.addEventListener("iron-overlay-closed", handleDropdownClosed);
    addEventListener("resize", handleWindowResize);

    return () => {
      elDropdown.removeEventListener("iron-overlay-opened", handleDropdownOpened);
      elDropdown.removeEventListener("iron-overlay-closed", handleDropdownClosed);
      removeEventListener("resize", handleWindowResize);
    };
  });
}
