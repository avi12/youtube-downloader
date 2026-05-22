import { ATTR_GRID_ITEM, isCardPending, mountGridButton, Selector } from "./grid-card";
import { CHILD_LIST_SUBTREE } from "@/lib/utils/dom";

const VIEWPORT_MARGIN = "200px";
const MOUNT_RETRY_MAX = 8;

let gridObserver: MutationObserver | null = null;
let visibilityObserver: IntersectionObserver | null = null;

export function cleanupGridUi() {
  gridObserver?.disconnect();
  gridObserver = null;
  visibilityObserver?.disconnect();
  visibilityObserver = null;

  for (const elItem of document.querySelectorAll(`[${ATTR_GRID_ITEM}]`)) {
    elItem.remove();
  }
}

function tryMountWithRetries({ context, elCard, attempts = MOUNT_RETRY_MAX }: {
  context: InstanceType<typeof ContentScriptContext>;
  elCard: Element;
  attempts?: number;
}): void {
  const didMount = mountGridButton({
    context,
    elCard
  });
  if (didMount) {
    visibilityObserver?.unobserve(elCard);
    return;
  }

  const hasRetriesLeft = attempts > 0;
  if (!hasRetriesLeft) {
    return;
  }

  requestAnimationFrame(() => tryMountWithRetries({
    context,
    elCard,
    attempts: attempts - 1
  }));
}

function createVisibilityObserver(context: InstanceType<typeof ContentScriptContext>) {
  return new IntersectionObserver(
    entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) {
          continue;
        }

        tryMountWithRetries({
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
    const isPending = isCardPending(elCard);
    if (isPending) {
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
