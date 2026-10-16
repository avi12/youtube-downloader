import { WatchButtonLayout } from "./watch-button-types";
import { CHILD_LIST_SUBTREE } from "@/lib/utils/dom";

const ACTIONS_CONTAINER_SELECTORS = {
  [WatchButtonLayout.Watch]: [
    "#above-the-fold #top-level-buttons-computed",
    "ytd-watch-metadata #top-level-buttons-computed",
    "#top-level-buttons-computed"
  ],
  [WatchButtonLayout.Shorts]: [
    "ytd-reel-video-renderer[is-active] reel-action-bar-view-model",
    "reel-action-bar-view-model"
  ]
} as const satisfies Record<WatchButtonLayout, readonly string[]>;

function findFirstVisibleActionsContainer(layout: WatchButtonLayout) {
  for (const selector of ACTIONS_CONTAINER_SELECTORS[layout]) {
    for (const elButton of document.querySelectorAll<HTMLElement>(selector)) {
      const isVisible = elButton.offsetWidth > 0 && elButton.offsetHeight > 0;
      if (isVisible) {
        return elButton;
      }
    }
  }

  return null;
}

export function findShortsActionsContainer() {
  return findFirstVisibleActionsContainer(WatchButtonLayout.Shorts);
}

export async function findVideoActionsContainer({ layout, signal }: {
  layout: WatchButtonLayout;
  signal: AbortSignal;
}) {
  const existing = findFirstVisibleActionsContainer(layout);
  if (existing) {
    return existing;
  }

  return new Promise<HTMLElement | null>(resolve => {
    const observer = new MutationObserver(() => {
      const elVisible = findFirstVisibleActionsContainer(layout);
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
