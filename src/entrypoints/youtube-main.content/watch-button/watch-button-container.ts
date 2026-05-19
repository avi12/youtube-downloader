import { CHILD_LIST_SUBTREE } from "@/lib/utils/dom";

const VIDEO_ACTION_BUTTON_SELECTORS = [
  "#above-the-fold #top-level-buttons-computed",
  "ytd-watch-metadata #top-level-buttons-computed",
  "#top-level-buttons-computed"
] as const;

function findFirstVisibleActionsContainer() {
  for (const selector of VIDEO_ACTION_BUTTON_SELECTORS) {
    for (const elButton of document.querySelectorAll<HTMLElement>(selector)) {
      const isVisible = elButton.offsetWidth > 0 && elButton.offsetHeight > 0;
      if (isVisible) {
        return elButton;
      }
    }
  }

  return null;
}

export async function findVideoActionsContainer(signal: AbortSignal) {
  const existing = findFirstVisibleActionsContainer();
  if (existing) {
    return existing;
  }

  return new Promise<HTMLElement | null>(resolve => {
    const observer = new MutationObserver(() => {
      const elVisible = findFirstVisibleActionsContainer();
      if (!elVisible) {
        return;
      }

      observer.disconnect();
      resolve(elVisible);
    });

    observer.observe(document.documentElement, CHILD_LIST_SUBTREE);
    signal.addEventListener("abort", () => {
      observer.disconnect();
      resolve(null);
    }, { once: true });
  });
}
