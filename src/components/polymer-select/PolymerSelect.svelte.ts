import { createMenuKeydownHandler, createMenuSelectedHandler } from "./PolymerSelect.menu-events";
import { attachSelectTrigger } from "./PolymerSelect.trigger-events";
import type { TpYtIronDropdownElement } from "@/types";

export interface PolymerSelectParams {
  readonly value: string;
  readonly onchange: (value: string) => void;
}

function isTpYtIronDropdown(elTarget: Element): elTarget is TpYtIronDropdownElement {
  return elTarget instanceof HTMLElement && "open" in elTarget && "positionTarget" in elTarget;
}

export function createPolymerSelectState(params: PolymerSelectParams) {
  let isOpen = $state(false);
  let elTrigger = $state<HTMLElement | null>(null);
  let elDropdown = $state<TpYtIronDropdownElement | null>(null);
  let elMenu = $state<HTMLElement | null>(null);

  function focusTrigger() {
    elTrigger?.focus();
  }

  function setIsOpen(value: boolean) {
    isOpen = value;
  }

  function attachTrigger(elTarget: Element) {
    if (!(elTarget instanceof HTMLElement)) {
      return;
    }

    elTrigger = elTarget;
    return attachSelectTrigger(elTarget, () => {
      isOpen = !isOpen;
    }, () => {
      isOpen = true;
    });
  }

  function attachDropdown(elTarget: Element) {
    if (!isTpYtIronDropdown(elTarget)) {
      return;
    }

    elDropdown = elTarget;
    elTarget.positionTarget = elTrigger;
    elTarget.fitInto = window;
    elTarget.dynamicAlign = true;

    requestAnimationFrame(() => document.body.appendChild(elTarget));

    function handleOverlayClosed() {
      isOpen = false;
      focusTrigger();
    }

    elTarget.addEventListener("iron-overlay-closed", handleOverlayClosed);
    return () => {
      elTarget.removeEventListener("iron-overlay-closed", handleOverlayClosed);
      elTarget.remove();
    };
  }

  function attachMenu(elTarget: Element) {
    if (!(elTarget instanceof HTMLElement)) {
      return;
    }

    elMenu = elTarget;
    const menuHandlerParams = {
      getValue: () => params.value,
      onchange: params.onchange,
      setIsOpen,
      focusTrigger
    };
    const handleSelectedChanged = createMenuSelectedHandler(menuHandlerParams);
    const handleKeydown = createMenuKeydownHandler(menuHandlerParams);
    elTarget.addEventListener("selected-changed", handleSelectedChanged);
    elTarget.addEventListener("keydown", handleKeydown);
    return () => {
      elTarget.removeEventListener("selected-changed", handleSelectedChanged);
      elTarget.removeEventListener("keydown", handleKeydown);
    };
  }

  $effect(() => {
    if (!elDropdown) {
      return;
    }

    if (isOpen) {
      elDropdown.open();
      requestAnimationFrame(() => elMenu?.focus());
    } else {
      elDropdown.close();
    }
  });

  return {
    get isOpen() {
      return isOpen;
    },
    attachTrigger,
    attachDropdown,
    attachMenu
  };
}
