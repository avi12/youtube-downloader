const PAPER_DROPDOWN_MENU_TAG = "tp-yt-paper-dropdown-menu";
const KEYBOARD_FOCUSED_ATTR = "keyboard-focused";

function handleDropdownFocusIn(e: FocusEvent) {
  if (!(e.target instanceof Element)) {
    return;
  }

  const elDropdown = e.target.closest(PAPER_DROPDOWN_MENU_TAG);
  if (!elDropdown) {
    return;
  }

  if (elDropdown.receivedFocusFromKeyboard) {
    elDropdown.setAttribute(KEYBOARD_FOCUSED_ATTR, "");
  }
}

function handleDropdownFocusOut(e: FocusEvent) {
  if (!(e.target instanceof Element)) {
    return;
  }

  const elDropdown = e.target.closest(PAPER_DROPDOWN_MENU_TAG);
  if (!elDropdown) {
    return;
  }

  requestAnimationFrame(() => {
    if (!elDropdown.contains(document.activeElement)) {
      elDropdown.removeAttribute(KEYBOARD_FOCUSED_ATTR);
    }
  });
}

export function registerDropdownFocusHandlers() {
  document.addEventListener("focusin", handleDropdownFocusIn);
  document.addEventListener("focusout", handleDropdownFocusOut);
}
