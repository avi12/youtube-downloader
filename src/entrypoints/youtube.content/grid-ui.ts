/**
 * Injects per-video download buttons into video grid pages
 * (homepage, subscriptions feed, channel pages).
 *
 * Handles two YouTube renderer types:
 * - yt-lockup-view-model (homepage, subscriptions) - video ID in content-id-* class
 * - ytd-rich-item-renderer (channel pages) - video ID in anchor href
 *
 * Uses MutationObserver to handle infinite scroll.
 */

import PlaylistVideoItem from "@/components/PlaylistVideoItem.svelte";
import type { Options } from "@/types";
import { mount } from "svelte";

const VIDEO_CARD_SELECTOR = "yt-lockup-view-model, ytd-rich-item-renderer";
const PAGE_MANAGER_SELECTOR = "ytd-page-manager";

let gridObserver: MutationObserver | null = null;

export function cleanupGridUi() {
  gridObserver?.disconnect();
  gridObserver = null;

  for (const elItem of document.querySelectorAll("[data-ytdl-grid-item]")) {
    elItem.remove();
  }
}

function extractVideoId(elCard: Element) {
  // yt-lockup-view-model: video ID in a child's content-id-* class
  const elContentId = elCard.querySelector("[class*='content-id-']");
  const contentIdMatch = elContentId?.getAttribute("class")?.match(/content-id-(\S+)/);
  if (contentIdMatch) {
    return contentIdMatch[1];
  }

  // ytd-rich-item-renderer: video ID in anchor href
  const elLink = elCard.querySelector<HTMLAnchorElement>("a#video-title-link, a#video-title");
  if (!elLink) {
    return null;
  }

  try {
    return new URLSearchParams(new URL(elLink.href).search).get("v");
  } catch {
    return null;
  }
}

function findAnchorElement(elCard: Element) {
  // yt-lockup-view-model: inject before the menu button container
  const elMenuButton = elCard.querySelector(".yt-lockup-metadata-view-model__menu-button");
  if (elMenuButton) {
    return elMenuButton;
  }

  // ytd-rich-item-renderer: inject inside the menu's top-level buttons area
  // so it sits next to the 3-dot icon within the same absolute-positioned container
  const elTopLevelButtons = elCard.querySelector("ytd-menu-renderer #top-level-buttons-computed");
  if (elTopLevelButtons) {
    return elTopLevelButtons;
  }

  return null;
}

function injectGridVideoButton(
  context: InstanceType<typeof ContentScriptContext>,
  options: Options,
  elCard: Element
) {
  const videoId = extractVideoId(elCard);
  if (!videoId || elCard.querySelector(`[data-ytdl-grid-item="${videoId}"]`)) {
    return;
  }

  const elAnchor = findAnchorElement(elCard);
  if (!elAnchor) {
    return;
  }

  // Ensure the menu renders above the title text (they overlap due to position:absolute)
  const elMenu = elCard.querySelector("ytd-menu-renderer");
  if (elMenu instanceof HTMLElement) {
    elMenu.style.zIndex = "1";
  }

  const elItemContainer = document.createElement("div");
  elItemContainer.setAttribute("data-ytdl-grid-item", videoId);
  elAnchor.append(elItemContainer);

  const ui = createIntegratedUi(context, {
    position: "inline",
    anchor: elItemContainer,
    onMount(elUiContainer) {
      mount(PlaylistVideoItem, {
        target: elUiContainer,
        props: { videoId, options }
      });
    }
  });

  ui.mount();
}

export function injectGridVideoButtons(
  context: InstanceType<typeof ContentScriptContext>,
  options: Options
) {
  function inject(elCard: Element) {
    injectGridVideoButton(context, options, elCard);
  }

  function scanAllCards() {
    for (const elCard of document.querySelectorAll(VIDEO_CARD_SELECTOR)) {
      inject(elCard);
    }
  }

  scanAllCards();

  gridObserver?.disconnect();
  gridObserver = new MutationObserver(scanAllCards);

  const elPageContent = document.querySelector(PAGE_MANAGER_SELECTOR) ?? document.body;
  gridObserver.observe(elPageContent, { childList: true, subtree: true });
  context.onInvalidated(() => gridObserver?.disconnect());
}

const NON_GRID_ROUTES = ["/watch", "/playlist", "/shorts", "/results", "/premium", "/account"];

export function isVideoGridPage(pathname: string) {
  return !NON_GRID_ROUTES.some(route => pathname.startsWith(route));
}
