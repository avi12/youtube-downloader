/**
 * Marks all elements outside the panel's ancestor chain as `inert`,
 * creating a native focus trap without manual Tab/Shift-Tab interception.
 * Returns a cleanup function that removes the inert attributes.
 */
export function applyInertTrap(elPanel: HTMLElement) {
  const inertedElements: HTMLElement[] = [];

  // Walk from the panel up to body, marking siblings of each ancestor as inert.
  // This keeps the panel and its container chain focusable while everything
  // else on the page becomes inert (unfocusable + hidden from assistive tech).
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
