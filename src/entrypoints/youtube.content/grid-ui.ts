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

import PlaylistDownloader from "@/components/PlaylistDownloader.svelte";
import PlaylistVideoItem from "@/components/PlaylistVideoItem.svelte";
import { getVideoIdFromUrl } from "@/lib/utils";
import type { Options } from "@/types";
import { mount, unmount } from "svelte";

const VIDEO_CARD_SELECTOR = "yt-lockup-view-model, ytd-rich-item-renderer";
const PAGE_MANAGER_SELECTOR = "ytd-page-manager";

let gridObserver: MutationObserver | null = null;
let gridDownloaderInstance: ReturnType<typeof mount> | null = null;

export function cleanupGridUi() {
  gridObserver?.disconnect();
  gridObserver = null;

  if (gridDownloaderInstance) {
    void unmount(gridDownloaderInstance);
    gridDownloaderInstance = null;
  }

  for (const elItem of document.querySelectorAll("[data-ytdl-grid-item], [data-ytdl-grid-downloader]")) {
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

  return getVideoIdFromUrl(elLink.href);
}

function findAnchorElement(elCard: Element) {
  // yt-lockup-view-model: inject after the text container (aligned with title)
  const elTextContainer = elCard.querySelector(".ytLockupMetadataViewModelTextContainer");
  if (elTextContainer) {
    return elTextContainer;
  }

  // ytd-rich-item-renderer (channel pages): inject after #details
  // as a sibling inside #dismissible so the buttons appear below
  // the title row, not crammed inside the horizontal flex layout.
  const elDismissible = elCard.querySelector("#dismissible");
  const elDetails = elDismissible?.querySelector("#details");
  if (elDismissible && elDetails) {
    return elDismissible;
  }

  return null;
}

function injectGridVideoButton({ context, options, elCard }: {
  context: InstanceType<typeof ContentScriptContext>;
  options: Options;
  elCard: Element;
}) {
  const videoId = extractVideoId(elCard);
  if (!videoId || elCard.querySelector(`[data-ytdl-grid-item="${videoId}"]`)) {
    return;
  }

  const elAnchor = findAnchorElement(elCard);
  if (!elAnchor) {
    return;
  }

  // Extract the grid title from YouTube's DOM (may differ from player response title)
  const gridTitle = elCard.querySelector("h3")?.textContent?.trim() ?? "";

  const elItemContainer = document.createElement("div");
  elItemContainer.dataset.ytdlGridItem = videoId;

  // For yt-lockup-view-model (subscriptions/homepage): append inside text container
  // For ytd-rich-item-renderer (channel pages): insert after #details
  const elDetails = elAnchor.querySelector("#details");
  if (elDetails) {
    elDetails.insertAdjacentElement("afterend", elItemContainer);
  } else {
    elAnchor.append(elItemContainer);
  }

  const ui = createIntegratedUi(context, {
    position: "inline",
    anchor: elItemContainer,
    onMount(elUiContainer) {
      mount(PlaylistVideoItem, {
        target: elUiContainer,
        props: {
          videoId,
          gridTitle,
          options
        }
      });
    }
  });

  ui.mount();
}

function injectGridDownloadAllButton(
  context: InstanceType<typeof ContentScriptContext>,
  options: Options
) {
  if (document.querySelector("[data-ytdl-grid-downloader]")) {
    return;
  }

  // Place next to the filter chips (Latest, Popular, Oldest) on channel pages
  const elChipBar = document.querySelector("chip-bar-view-model");
  if (!elChipBar) {
    return;
  }

  const elContainer = document.createElement("div");
  elContainer.dataset.ytdlGridDownloader = "true";
  elContainer.style.display = "inline-flex";
  elContainer.style.alignItems = "center";
  elContainer.style.marginInlineStart = "8px";
  elChipBar.insertAdjacentElement("afterend", elContainer);

  const ui = createIntegratedUi(context, {
    position: "inline",
    anchor: elContainer,
    onMount(elUiContainer) {
      gridDownloaderInstance = mount(PlaylistDownloader, {
        target: elUiContainer,
        props: { options }
      });
    }
  });

  ui.mount();
}

const INJECTION_BATCH_SIZE = 10;

function scanAndInjectCards(
  context: InstanceType<typeof ContentScriptContext>,
  options: Options
) {
  const pendingCards = [...document.querySelectorAll(VIDEO_CARD_SELECTOR)].filter(
    elCard => {
      const videoId = extractVideoId(elCard);
      return videoId && !elCard.querySelector(`[data-ytdl-grid-item="${videoId}"]`);
    }
  );

  if (pendingCards.length === 0) {
    return;
  }

  let iBatch = 0;
  function injectBatch() {
    const start = iBatch * INJECTION_BATCH_SIZE;
    const batch = pendingCards.slice(start, start + INJECTION_BATCH_SIZE);

    for (const elCard of batch) {
      injectGridVideoButton({ context, options, elCard });
    }

    iBatch++;
    if (start + INJECTION_BATCH_SIZE < pendingCards.length) {
      requestAnimationFrame(injectBatch);
    }
  }

  injectBatch();
}

export function injectGridVideoButtons(
  context: InstanceType<typeof ContentScriptContext>,
  options: Options
) {
  scanAndInjectCards(context, options);
  injectGridDownloadAllButton(context, options);

  gridObserver?.disconnect();
  gridObserver = new MutationObserver(() => scanAndInjectCards(context, options));

  const elPageContent = document.querySelector(PAGE_MANAGER_SELECTOR) ?? document.body;
  gridObserver.observe(elPageContent, {
    childList: true,
    subtree: true
  });
  context.onInvalidated(() => gridObserver?.disconnect());
}

const NON_GRID_ROUTES = ["/watch", "/playlist", "/shorts", "/results", "/premium", "/account"];

export function isVideoGridPage(pathname: string) {
  return !NON_GRID_ROUTES.some(route => pathname.startsWith(route));
}
