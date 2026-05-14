export function attachOpenMenuListeners(params: {
  elMenu: HTMLElement;
  getElTrigger: () => HTMLElement | null;
  getElMenu: () => HTMLElement | null;
  setIsOpen: (isOpen: boolean) => void;
  syncMenuMaxHeight: () => void;
}) {
  params.syncMenuMaxHeight();
  requestAnimationFrame(() => params.elMenu.focus());

  function handleOutsideClick(e: MouseEvent) {
    if (
      e.target instanceof Node
      && !params.getElTrigger()?.contains(e.target)
      && !params.getElMenu()?.contains(e.target)
    ) {
      params.setIsOpen(false);
    }
  }

  function handleResize() {
    requestAnimationFrame(params.syncMenuMaxHeight);
  }

  document.addEventListener("mousedown", handleOutsideClick, true);
  addEventListener("resize", handleResize);
  return () => {
    document.removeEventListener("mousedown", handleOutsideClick, true);
    removeEventListener("resize", handleResize);
  };
}
