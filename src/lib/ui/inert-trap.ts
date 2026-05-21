export function applyInertTrap(elPanel: HTMLElement) {
  const inertedElements: HTMLElement[] = [];

  let elAncestor: HTMLElement | null = elPanel;
  while (elAncestor && elAncestor !== document.body) {
    for (const elSibling of elAncestor.parentElement?.children ?? []) {
      const isSiblingExcluded = elSibling === elAncestor || !(elSibling instanceof HTMLElement) || elSibling.inert || elSibling.hasAttribute("data-ytdl-moved");      if (isSiblingExcluded) {
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
