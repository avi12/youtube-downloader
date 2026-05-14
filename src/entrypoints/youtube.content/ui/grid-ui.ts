import { isCardPending, mountGridButton, Selector } from "./grid-card";
import { CHILD_LIST_SUBTREE } from "@/lib/utils/dom";

const VIEWPORT_MARGIN = "200px";

let gridObserver: MutationObserver | null = null;
let visibilityObserver: IntersectionObserver | null = null;

export function cleanupGridUi() {
  gridObserver?.disconnect();
  gridObserver = null;
  visibilityObserver?.disconnect();
  visibilityObserver = null;

  for (const elItem of document.querySelectorAll("[data-ytdl-grid-item]")) {
    elItem.remove();
  }
}

function createVisibilityObserver(context: InstanceType<typeof ContentScriptContext>) {
  return new IntersectionObserver(
    entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) {
          continue;
        }

        visibilityObserver?.unobserve(entry.target);
        mountGridButton({
          context,
          elCard: entry.target
        });
      }
    },
    { rootMargin: VIEWPORT_MARGIN }
  );
}

function observePendingCards() {
  if (!visibilityObserver) {
    return;
  }

  for (const elCard of document.querySelectorAll(Selector.VideoCard)) {
    if (isCardPending(elCard)) {
      visibilityObserver.observe(elCard);
    }
  }
}

export function injectGridVideoButtons(context: InstanceType<typeof ContentScriptContext>) {
  visibilityObserver = createVisibilityObserver(context);
  observePendingCards();

  gridObserver?.disconnect();
  gridObserver = new MutationObserver(observePendingCards);

  const elPageContent = document.querySelector(Selector.PageManager) ?? document.body;
  gridObserver.observe(elPageContent, CHILD_LIST_SUBTREE);
  context.onInvalidated(() => {
    gridObserver?.disconnect();
    visibilityObserver?.disconnect();
  });
}
