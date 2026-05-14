function handleDropdownFocusIn(e: FocusEvent) {
  if (!(e.target instanceof Element)) {
    return;
  }

  const elDropdown = e.target.closest("tp-yt-paper-dropdown-menu");
  if (!elDropdown) {
    return;
  }

  if (elDropdown.receivedFocusFromKeyboard) {
    elDropdown.setAttribute("keyboard-focused", "");
  }
}

function handleDropdownFocusOut(e: FocusEvent) {
  if (!(e.target instanceof Element)) {
    return;
  }

  const elDropdown = e.target.closest("tp-yt-paper-dropdown-menu");
  if (!elDropdown) {
    return;
  }

  requestAnimationFrame(() => {
    if (!elDropdown.contains(document.activeElement)) {
      elDropdown.removeAttribute("keyboard-focused");
    }
  });
}

export function registerDropdownFocusHandlers() {
  document.addEventListener("focusin", handleDropdownFocusIn);
  document.addEventListener("focusout", handleDropdownFocusOut);
}
