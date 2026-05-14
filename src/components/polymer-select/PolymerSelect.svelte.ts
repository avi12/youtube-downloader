import { createMenuKeydownHandler, createMenuSelectedHandler } from "./PolymerSelect.menu-events";
import { attachOpenMenuListeners } from "./PolymerSelect.open-effect";
import { attachSelectTrigger } from "./PolymerSelect.trigger-events";

export interface PolymerSelectParams {
  readonly value: string;
  readonly onchange: (value: string) => void;
}

const MENU_HEIGHT_GAP = 4;
const MENU_HEIGHT_CHROME = 10;
const MENU_HEIGHT_MARGIN = 8;

export function createPolymerSelectState(params: PolymerSelectParams) {
  let isOpen = $state(false);
  let elTrigger = $state<HTMLElement | null>(null);
  let elMenu = $state<HTMLElement | null>(null);

  function focusTrigger() {
    elTrigger?.focus();
  }

  function setIsOpen(isOpenValue: boolean) {
    isOpen = isOpenValue;
  }

  function syncMenuMaxHeight() {
    if (!elTrigger || !elMenu) {
      return;
    }

    const available = innerHeight - elTrigger.getBoundingClientRect().bottom
      - MENU_HEIGHT_GAP - MENU_HEIGHT_CHROME - MENU_HEIGHT_MARGIN;
    elMenu.style.maxHeight = `${Math.max(available, 120)}px`;
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
    if (!isOpen || !elMenu) {
      return;
    }

    return attachOpenMenuListeners({
      elMenu,
      getElTrigger: () => elTrigger,
      getElMenu: () => elMenu,
      setIsOpen,
      syncMenuMaxHeight
    });
  });

  return {
    get isOpen() {
      return isOpen;
    },
    attachTrigger,
    attachMenu
  };
}
