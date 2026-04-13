export function applyInertTrap(elPanel: HTMLElement) {
  const inertedElements: HTMLElement[] = [];

  for (let elAncestor = elPanel; elAncestor && elAncestor !== document.body; elAncestor = elAncestor.parentElement!) {
    for (const elSibling of elAncestor.parentElement?.children ?? []) {
      if (elSibling === elAncestor || !(elSibling instanceof HTMLElement) || elSibling.inert) {
        continue;
      }

      elSibling.inert = true;
      inertedElements.push(elSibling);
    }
  }

  return () => {
    for (const elElement of inertedElements) {
      elElement.inert = false;
    }
  };
}
