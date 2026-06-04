import { CHILD_LIST_SUBTREE } from "@/lib/utils/dom";
import { isYtLockupViewModelElement } from "@/lib/youtube/schemas";
import type { Prettify } from "@/types";

const CONTENT_ID_ATTR = "data-ytdl-content-id";
const LOCKUP_SELECTOR = "yt-lockup-view-model";
const MAX_RETRIES = 3;

function extractContentId(elCard: Element) {
  const [, contentId] = elCard.shadowRoot
    ?.querySelector("[class*='content-id-']")
    ?.className.match(/content-id-(\S+)/) ?? [];
  if (contentId) {
    return contentId;
  }

  if (!isYtLockupViewModelElement(elCard)) {
    return null;
  }

  return elCard.data.contentId
    ?? elCard.data.lockupRenderer?.contentId
    ?? elCard.data.videoRenderer?.videoId
    ?? null;
}

type TagCardParams = Prettify<{
  elCard: Element;
  retriesLeft?: number;
}>;
function tagCard({ elCard, retriesLeft = MAX_RETRIES }: TagCardParams) {
  if (elCard.hasAttribute(CONTENT_ID_ATTR)) {
    return;
  }

  const contentId = extractContentId(elCard);
  if (contentId) {
    elCard.setAttribute(CONTENT_ID_ATTR, contentId);
    return;
  }

  const hasRetriesLeft = retriesLeft > 0;
  if (hasRetriesLeft) {
    requestAnimationFrame(() => tagCard({
      elCard,
      retriesLeft: retriesLeft - 1
    }));
  }
}

function tagAllCards() {
  for (const elCard of document.querySelectorAll(`${LOCKUP_SELECTOR}:not([${CONTENT_ID_ATTR}])`)) {
    tagCard({ elCard });
  }
}

export function registerGridTagger() {
  tagAllCards();

  const observer = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      for (const elNode of mutation.addedNodes) {
        if (!(elNode instanceof Element)) {
          continue;
        }

        const isLockupElement = elNode.matches(LOCKUP_SELECTOR);
        if (isLockupElement) {
          tagCard({ elCard: elNode });
        }

        for (const elCard of elNode.querySelectorAll(LOCKUP_SELECTOR)) {
          tagCard({ elCard });
        }
      }
    }
  });

  observer.observe(document.documentElement, CHILD_LIST_SUBTREE);
}
