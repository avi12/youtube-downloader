/**
 * Injects per-video download buttons into video grid pages
 * (homepage, subscriptions feed, channel pages).
 *
 * Uses MutationObserver to handle infinite scroll.
 */

import PlaylistVideoItem from "@/components/PlaylistVideoItem.svelte";
import type { Options } from "@/types";
import { mount } from "svelte";

let gridObserver: MutationObserver | null = null;

export function cleanupGridUi() {
  gridObserver?.disconnect();
  gridObserver = null;

  for (const elItem of document.querySelectorAll("[data-ytdl-grid-item]")) {
    elItem.remove();
  }
}

function extractVideoIdFromLockup(elLockup: Element) {
  const contentIdClass = [...elLockup.classList].find(cls => cls.startsWith("content-id-"));
  if (contentIdClass) {
    return contentIdClass.replace("content-id-", "");
  }

  const elLink = elLockup.querySelector<HTMLAnchorElement>("a[href*=\"/watch\"]");
  if (!elLink) {
    return null;
  }

  try {
    return new URLSearchParams(new URL(elLink.href).search).get("v");
  } catch {
    return null;
  }
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
  for (const elLockup of document.querySelectorAll("yt-lockup-view-model")) {
    injectGridVideoButton(context, options, elLockup);
  }

  gridObserver?.disconnect();
  gridObserver = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (!(node instanceof HTMLElement)) {
          continue;
        }

        const lockups = node.matches("yt-lockup-view-model")
          ? [node]
          : [...node.querySelectorAll("yt-lockup-view-model")];

        for (const elLockup of lockups) {
          injectGridVideoButton(context, options, elLockup);
        }
      }
    }
  });

  const elPageContent = document.querySelector("ytd-page-manager") ?? document.body;
  gridObserver.observe(elPageContent, { childList: true, subtree: true });
  context.onInvalidated(() => gridObserver?.disconnect());
}

export function isVideoGridPage(pathname: string) {
  return pathname === "/"
    || pathname.startsWith("/feed/")
    || pathname.startsWith("/@");
}
