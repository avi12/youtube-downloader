export function createMenuSelectedHandler(params: {
  getValue: () => string;
  onchange: (v: string) => void;
  setIsOpen: (v: boolean) => void;
  focusTrigger: () => void;
}) {
  return (e: Event) => {
    if (!(e instanceof CustomEvent)) {
      return;
    }

    const dataValue: string = e.detail?.value;
    if (!dataValue) {
      return;
    }

    if (dataValue !== params.getValue()) {
      params.onchange(dataValue);
    }

    params.setIsOpen(false);
    params.focusTrigger();
  };
}

export function createMenuKeydownHandler(params: {
  getValue: () => string;
  setIsOpen: (v: boolean) => void;
  focusTrigger: () => void;
}) {
  return (e: Event) => {
    if (!(e instanceof KeyboardEvent)) {
      return;
    }

    if (e.key === "Escape") {
      e.preventDefault();
      params.setIsOpen(false);
      params.focusTrigger();
      return;
    }

    if (e.key === "Tab") {
      params.setIsOpen(false);
      params.focusTrigger();
      return;
    }

    if (e.key === "Enter" || e.key === " ") {
      const elActive = document.activeElement;
      if (elActive instanceof HTMLElement && elActive.matches("tp-yt-paper-item")) {
        const dataValue = elActive.getAttribute("data-value");
        if (dataValue === params.getValue()) {
          e.preventDefault();
          params.setIsOpen(false);
          params.focusTrigger();
        }
      }
    }
  };
}
