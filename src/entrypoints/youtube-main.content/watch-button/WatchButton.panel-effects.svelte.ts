import type { TpYtIronDropdownElement, YtButtonViewModelElement } from "@/types";

export function createPanelEffects({
  getElGroup,
  getElChevronButton,
  getElDropdown,
  getIsPanelOpen,
  getIsPanelBelow,
  setIsPanelOpen,
  setIsPanelBelow
}: {
  getElGroup: () => HTMLDivElement | null;
  getElChevronButton: () => YtButtonViewModelElement | null;
  getElDropdown: () => TpYtIronDropdownElement;
  getIsPanelOpen: () => boolean;
  getIsPanelBelow: () => boolean;
  setIsPanelOpen: (value: boolean) => void;
  setIsPanelBelow: (value: boolean) => void;
}) {
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
    const hasPanelBelowChanged = newIsPanelBelow !== getIsPanelBelow();
    if (hasPanelBelowChanged) {
      setIsPanelBelow(newIsPanelBelow);
    }
  }

  $effect(() => {
    const elSlot = getElDropdown().querySelector<HTMLElement>("[data-ytdl-panel-slot]");
    elSlot?.style.setProperty("--ytdl-panel-origin", getIsPanelBelow() ? "top" : "bottom");
  });

  $effect(() => {
    const elDropdown = getElDropdown();
    let resizeObserver: ResizeObserver | null = null;

    function handleDropdownOpened(e: Event) {
      const isOtherTarget = e.target !== elDropdown;
      if (isOtherTarget) {
        return;
      }

      const groupRect = getElGroup()?.getBoundingClientRect();
      const dropdownRect = elDropdown.getBoundingClientRect();
      const isGroupMissing = !groupRect;
      if (isGroupMissing) {
        return;
      }

      setIsPanelBelow(dropdownRect.top >= groupRect.bottom - 1);

      resizeObserver = new ResizeObserver(() => elDropdown.refit());
      resizeObserver.observe(elDropdown);
    }

    function handleDropdownClosed() {
      resizeObserver?.disconnect();
      resizeObserver = null;

      const isPanelClosed = !getIsPanelOpen();
      if (isPanelClosed) {
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
      resizeObserver?.disconnect();
      elDropdown.removeEventListener("iron-overlay-opened", handleDropdownOpened);
      elDropdown.removeEventListener("iron-overlay-closed", handleDropdownClosed);
      elDropdown.removeEventListener("iron-resize", syncPanelBelowState);
      removeEventListener("resize", handleWindowResize);
    };
  });
}
