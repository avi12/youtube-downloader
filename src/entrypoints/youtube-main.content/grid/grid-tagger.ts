import { CHILD_LIST_SUBTREE } from "@/lib/utils/dom";
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

  if (!("data" in elCard) || !elCard.data || typeof elCard.data !== "object") {
    return null;
  }

  const data = elCard.data;
  if ("contentId" in data && typeof data.contentId === "string") {
    return data.contentId;
  }

  if ("lockupRenderer" in data && data.lockupRenderer && typeof data.lockupRenderer === "object") {
    const lockupRenderer = data.lockupRenderer;
    if ("contentId" in lockupRenderer && typeof lockupRenderer.contentId === "string") {
      return lockupRenderer.contentId;
    }
  }

  if ("videoRenderer" in data && data.videoRenderer && typeof data.videoRenderer === "object") {
    const videoRenderer = data.videoRenderer;
    if ("videoId" in videoRenderer && typeof videoRenderer.videoId === "string") {
      return videoRenderer.videoId;
    }
  }

  return null;
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
