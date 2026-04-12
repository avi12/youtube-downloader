import PlaylistVideoItem from "@/components/PlaylistVideoItem.svelte";
import { getVideoIdFromUrl } from "@/lib/youtube-url";
import type { Options } from "@/types";
import { mount } from "svelte";

const VIDEO_CARD_SELECTOR = "yt-lockup-view-model, ytd-rich-item-renderer, ytd-grid-video-renderer";
const PAGE_MANAGER_SELECTOR = "ytd-page-manager";
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

function extractVideoId(elCard: Element) {
  const elContentId = elCard.querySelector("[class*='content-id-']");
  const contentIdMatch = elContentId?.getAttribute("class")?.match(/content-id-(\S+)/);
  if (contentIdMatch) {
    return contentIdMatch[1];
  }

  const elLink = elCard.querySelector<HTMLAnchorElement>("a#video-title-link, a#video-title");
  if (!elLink) {
    return null;
  }

  return getVideoIdFromUrl(elLink.href);
}

function findAnchorElement(elCard: Element) {
  const elTextContainer = elCard.querySelector(".ytLockupMetadataViewModelTextContainer");
  if (elTextContainer) {
    return elTextContainer;
  }

  const elDismissible = elCard.querySelector("#dismissible");
  const elDetails = elDismissible?.querySelector("#details");
  if (elDismissible && elDetails) {
    return elDismissible;
  }

  return null;
}

function mountGridButton(
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

  const gridTitle = elCard.querySelector("h3")?.textContent?.trim() ?? "";

  const elItemContainer = document.createElement("div");
  elItemContainer.dataset.ytdlGridItem = videoId;

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
        props: { videoId, gridTitle, options }
      });
    }
  });

  ui.mount();
}

function isCardPending(elCard: Element) {
  const videoId = extractVideoId(elCard);
  return videoId && !elCard.querySelector(`[data-ytdl-grid-item="${videoId}"]`);
}

function createVisibilityObserver(
  context: InstanceType<typeof ContentScriptContext>,
  options: Options
) {
  return new IntersectionObserver(
    entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) {
          continue;
        }

        visibilityObserver?.unobserve(entry.target);
        mountGridButton(context, options, entry.target);
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

export function injectGridVideoButtons(
  context: InstanceType<typeof ContentScriptContext>,
  options: Options
) {
  visibilityObserver = createVisibilityObserver(context, options);
  observePendingCards();

  gridObserver?.disconnect();
  gridObserver = new MutationObserver(observePendingCards);

  const elPageContent = document.querySelector(PAGE_MANAGER_SELECTOR) ?? document.body;
  gridObserver.observe(elPageContent, { childList: true, subtree: true });
  context.onInvalidated(() => {
    gridObserver?.disconnect();
    visibilityObserver?.disconnect();
  });
}
