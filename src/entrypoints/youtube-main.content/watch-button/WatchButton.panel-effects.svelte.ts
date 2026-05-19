import type { TpYtIronDropdownElement, YtButtonViewModelElement } from "@/types";

const PANEL_VIEWPORT_MARGIN = 16;
const EVENT_IRON_OVERLAY_OPENED = "iron-overlay-opened";
const EVENT_IRON_OVERLAY_CLOSED = "iron-overlay-closed";
const EVENT_WINDOW_RESIZE = "resize";
const ATTR_PANEL_POSITION = "data-ytdl-panel-position";
const ATTR_PANEL_SLOT = "data-ytdl-panel-slot";
const CSS_VAR_PANEL_TOP_DISTANCE = "--ytdl-panel-top-distance";
const CSS_VAR_PANEL_BOTTOM_DISTANCE = "--ytdl-panel-bottom-distance";
const CSS_VAR_PANEL_MAX_HEIGHT = "--ytdl-panel-max-height";
const CSS_VAR_PANEL_ORIGIN = "--ytdl-panel-origin";
const PANEL_POSITION_BELOW = "below";
const PANEL_POSITION_ABOVE = "above";

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
      elDropdown.setAttribute(ATTR_PANEL_POSITION, PANEL_POSITION_BELOW);
      elDropdown.style.setProperty(CSS_VAR_PANEL_TOP_DISTANCE, `${chevronRect.bottom}px`);
      elDropdown.style.setProperty(CSS_VAR_PANEL_MAX_HEIGHT, `${spaceBelow - PANEL_VIEWPORT_MARGIN}px`);
      elDropdown.style.removeProperty(CSS_VAR_PANEL_BOTTOM_DISTANCE);
    } else {
      elDropdown.setAttribute(ATTR_PANEL_POSITION, PANEL_POSITION_ABOVE);
      elDropdown.style.setProperty(CSS_VAR_PANEL_BOTTOM_DISTANCE, `${innerHeight - chevronRect.top}px`);
      elDropdown.style.setProperty(CSS_VAR_PANEL_MAX_HEIGHT, `${spaceAbove - PANEL_VIEWPORT_MARGIN}px`);
      elDropdown.style.removeProperty(CSS_VAR_PANEL_TOP_DISTANCE);
    }

    setIsPanelBelow(isPanelBelow);
  }

  $effect(() => {
    const elSlot = getElDropdown().querySelector<HTMLElement>(`[${ATTR_PANEL_SLOT}]`);
    elSlot?.style.setProperty(CSS_VAR_PANEL_ORIGIN, getIsPanelBelow() ? "top" : "bottom");
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

    elDropdown.addEventListener(EVENT_IRON_OVERLAY_OPENED, handleDropdownOpened);
    elDropdown.addEventListener(EVENT_IRON_OVERLAY_CLOSED, handleDropdownClosed);
    addEventListener(EVENT_WINDOW_RESIZE, handleWindowResize);

    return () => {
      elDropdown.removeEventListener(EVENT_IRON_OVERLAY_OPENED, handleDropdownOpened);
      elDropdown.removeEventListener(EVENT_IRON_OVERLAY_CLOSED, handleDropdownClosed);
      removeEventListener(EVENT_WINDOW_RESIZE, handleWindowResize);
    };
  });
}
