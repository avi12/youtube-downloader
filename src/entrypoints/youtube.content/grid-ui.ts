/**
 * Injects per-video download buttons into video grid pages
 * (homepage, subscriptions feed, channel pages).
 *
 * Uses MutationObserver to handle infinite scroll.
 */

import PlaylistVideoItem from "@/components/PlaylistVideoItem.svelte";
import type { Options } from "@/types";
import { mount } from "svelte";

const LOCKUP_SELECTOR = "yt-lockup-view-model";
const PAGE_MANAGER_SELECTOR = "ytd-page-manager";

let gridObserver: MutationObserver | null = null;

export function cleanupGridUi() {
  gridObserver?.disconnect();
  gridObserver = null;

  for (const elItem of document.querySelectorAll("[data-ytdl-grid-item]")) {
    elItem.remove();
  }
}

function extractVideoIdFromLockup(elLockup: Element) {
  return elLockup.className.match(/content-id-(\S+)/)?.[1] ?? null;
}

async function injectGridVideoButton(
  context: InstanceType<typeof ContentScriptContext>,
  options: Options,
  elLockup: Element
) {
  const videoId = extractVideoIdFromLockup(elLockup);
  if (!videoId || elLockup.querySelector(`[data-ytdl-grid-item="${videoId}"]`)) {
    return;
  }

  const elMenuContainer = elLockup.querySelector(".yt-lockup-metadata-view-model__menu-button");
  if (!elMenuContainer) {
    return;
  }

  const elItemContainer = document.createElement("div");
  elItemContainer.setAttribute("data-ytdl-grid-item", videoId);
  elMenuContainer.insertAdjacentElement("beforebegin", elItemContainer);

  const ui = await createShadowRootUi(context, {
    name: `ytdl-grid-item-${videoId}`,
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
  function inject(elLockup: Element) {
    injectGridVideoButton(context, options, elLockup).catch(() => {});
  }

  for (const elLockup of document.querySelectorAll(LOCKUP_SELECTOR)) {
    inject(elLockup);
  }

  gridObserver?.disconnect();
  gridObserver = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (!(node instanceof HTMLElement)) {
          continue;
        }

        if (node.matches(LOCKUP_SELECTOR)) {
          inject(node);
          continue;
        }

        for (const elLockup of node.querySelectorAll(LOCKUP_SELECTOR)) {
          inject(elLockup);
        }
      }
    }
  });

  const elPageContent = document.querySelector(PAGE_MANAGER_SELECTOR) ?? document.body;
  gridObserver.observe(elPageContent, { childList: true, subtree: true });
  context.onInvalidated(() => gridObserver?.disconnect());
}

export function isVideoGridPage(pathname: string) {
  return pathname === "/"
    || pathname.startsWith("/feed/")
    || pathname.startsWith("/@");
}
