import { VIDEO_CARD_SELECTOR, isCardPending, mountGridButton } from "./grid-card-injector";
import { CHILD_LIST_SUBTREE } from "@/lib/utils/dom";
import { mount, unmount } from "svelte";

const PAGE_MANAGER_SELECTOR = "ytd-page-manager";
const VIEWPORT_MARGIN = "200px";

let gridObserver: MutationObserver | null = null;
let visibilityObserver: IntersectionObserver | null = null;
const overlayInstances = new Map<string, ReturnType<typeof mount>>();

export function cleanupGridUi() {
  gridObserver?.disconnect();
  gridObserver = null;
  visibilityObserver?.disconnect();
  visibilityObserver = null;

  for (const instance of overlayInstances.values()) {
    void unmount(instance);
  }
  overlayInstances.clear();

  for (const elItem of document.querySelectorAll("[data-ytdl-grid-item], [data-ytdl-progress]")) {
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

  for (const elCard of document.querySelectorAll(VIDEO_CARD_SELECTOR)) {
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

  const elPageContent = document.querySelector(PAGE_MANAGER_SELECTOR) ?? document.body;
  gridObserver.observe(elPageContent, CHILD_LIST_SUBTREE);
  context.onInvalidated(() => {
    gridObserver?.disconnect();
    visibilityObserver?.disconnect();
  });
}
