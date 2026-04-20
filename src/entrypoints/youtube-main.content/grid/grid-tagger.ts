import { CHILD_LIST_SUBTREE } from "@/lib/utils/dom";

const CONTENT_ID_ATTR = "data-ytdl-content-id";
const LOCKUP_SELECTOR = "yt-lockup-view-model";
const MAX_RETRIES = 3;

function extractContentId(elCard: Element): string | null {
  const shadowMatch = elCard.shadowRoot
    ?.querySelector("[class*='content-id-']")
    ?.className.match(/content-id-(\S+)/);
  if (shadowMatch) {
    return shadowMatch[1];
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

function tagCard(elCard: Element, retriesLeft = MAX_RETRIES) {
  if (elCard.hasAttribute(CONTENT_ID_ATTR)) {
    return;
  }

  const contentId = extractContentId(elCard);
  if (contentId) {
    elCard.setAttribute(CONTENT_ID_ATTR, contentId);
    return;
  }

  if (retriesLeft > 0) {
    requestAnimationFrame(() => tagCard(elCard, retriesLeft - 1));
  }
}

function tagAllCards() {
  for (const elCard of document.querySelectorAll(`${LOCKUP_SELECTOR}:not([${CONTENT_ID_ATTR}])`)) {
    tagCard(elCard);
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

        if (elNode.matches(LOCKUP_SELECTOR)) {
          tagCard(elNode);
        }

        for (const elCard of elNode.querySelectorAll(LOCKUP_SELECTOR)) {
          tagCard(elCard);
        }
      }
    }
  });

  observer.observe(document.documentElement, CHILD_LIST_SUBTREE);
}
