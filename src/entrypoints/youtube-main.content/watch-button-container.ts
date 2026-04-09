const VIDEO_ACTION_BUTTON_SELECTORS = [
  "#above-the-fold #top-level-buttons-computed",
  "ytd-watch-metadata #top-level-buttons-computed",
  "#top-level-buttons-computed"
];

function findFirstVisible() {
  for (const selector of VIDEO_ACTION_BUTTON_SELECTORS) {
    for (const elButton of document.querySelectorAll<HTMLElement>(selector)) {
      if (elButton.offsetWidth > 0 && elButton.offsetHeight > 0) {
        return elButton;
      }
    }
  }

  return null;
}

export async function findVideoActionsContainer(signal: AbortSignal) {
  const existing = findFirstVisible();
  if (existing) {
    return existing;
  }

  return new Promise<HTMLElement | null>(resolve => {
    const observer = new MutationObserver(() => {
      const elVisible = findFirstVisible();
      if (!elVisible) {
        return;
      }

      observer.disconnect();
      resolve(elVisible);
    });

    observer.observe(document.documentElement, { childList: true, subtree: true });
    signal.addEventListener("abort", () => {
      observer.disconnect();
      resolve(null);
    }, { once: true });
  });
}
