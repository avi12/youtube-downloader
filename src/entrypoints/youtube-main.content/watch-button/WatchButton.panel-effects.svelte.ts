import type { TpYtIronDropdownElement, YtButtonViewModelElement } from "@/types";

export function createPanelEffects(
  getElGroup: () => HTMLDivElement | null,
  getElChevronButton: () => YtButtonViewModelElement | null,
  getElDropdown: () => TpYtIronDropdownElement,
  getIsPanelOpen: () => boolean,
  getIsPanelBelow: () => boolean,
  setIsPanelOpen: (value: boolean) => void,
  setIsPanelBelow: (value: boolean) => void
) {
  function syncPanelBelowState() {
    const dropdownRect = getElDropdown().getBoundingClientRect();
    const isDropdownHidden = dropdownRect.width === 0 && dropdownRect.height === 0;
    if (isDropdownHidden) {
      return;
    }

    const groupRect = getElGroup()?.getBoundingClientRect();
    if (!groupRect) {
      return;
    }

    const newIsPanelBelow = dropdownRect.top >= groupRect.bottom - 1;
    if (newIsPanelBelow !== getIsPanelBelow()) {
      setIsPanelBelow(newIsPanelBelow);
    }
  }

  $effect(() => {
    const elDropdown = getElDropdown();

    function handleDropdownOpened(e: Event) {
      if (e.target !== elDropdown) {
        return;
      }

      const groupRect = getElGroup()?.getBoundingClientRect();
      const dropdownRect = elDropdown.getBoundingClientRect();
      if (!groupRect) {
        return;
      }

      setIsPanelBelow(dropdownRect.top >= groupRect.bottom - 1);
    }

    function handleDropdownClosed() {
      if (!getIsPanelOpen()) {
        return;
      }

      setIsPanelOpen(false);
      getElChevronButton()?.querySelector<HTMLButtonElement>("button")?.focus();
    }

    function handleWindowResize() {
      elDropdown.dispatchEvent(
        new CustomEvent("iron-resize", {
          bubbles: false,
          composed: false
        })
      );
      requestAnimationFrame(syncPanelBelowState);
    }

    elDropdown.addEventListener("iron-overlay-opened", handleDropdownOpened);
    elDropdown.addEventListener("iron-overlay-closed", handleDropdownClosed);
    elDropdown.addEventListener("iron-resize", syncPanelBelowState);
    addEventListener("resize", handleWindowResize);

    return () => {
      elDropdown.removeEventListener("iron-overlay-opened", handleDropdownOpened);
      elDropdown.removeEventListener("iron-overlay-closed", handleDropdownClosed);
      elDropdown.removeEventListener("iron-resize", syncPanelBelowState);
      removeEventListener("resize", handleWindowResize);
    };
  });
}
