export function applyInertTrap(elPanel: HTMLElement) {
  const inertedElements: HTMLElement[] = [];

  let elAncestor: HTMLElement | null = elPanel;
  while (elAncestor && elAncestor !== document.body) {
    for (const elSibling of elAncestor.parentElement?.children ?? []) {
      if (elSibling === elAncestor || !(elSibling instanceof HTMLElement) || elSibling.inert || elSibling.hasAttribute("data-ytdl-moved")) {
        continue;
      }

      elSibling.inert = true;
      inertedElements.push(elSibling);
    }

    elAncestor = elAncestor.parentElement;
  }

  return () => {
    for (const elElement of inertedElements) {
      elElement.inert = false;
    }
  };
}
