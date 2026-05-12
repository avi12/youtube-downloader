import PlaylistVideoItem from "@/components/playlist-downloader/PlaylistVideoItem.svelte";
import { CHILD_LIST_SUBTREE } from "@/lib/utils/dom";
import { getVideoIdFromUrl } from "@/lib/youtube/youtube-url";
import { mount } from "svelte";

const Selector = {
  VideoCard: "yt-lockup-view-model, ytd-rich-item-renderer, ytd-grid-video-renderer",
  PageManager: "ytd-page-manager"
} as const;

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

// Returns the yt-lockup-view-model element's shadow root if present, so callers
// can query inside it when native shadow DOM is in use.
function getLockupRoot(elCard: Element) {
  const elLockup = elCard.tagName.toLowerCase() === "yt-lockup-view-model"
    ? elCard
    : elCard.querySelector("yt-lockup-view-model");
  return elLockup?.shadowRoot ?? null;
}

function shadowFirst(elCard: Element, selector: string) {
  return getLockupRoot(elCard)?.querySelector(selector) ?? elCard.querySelector(selector);
}

function extractVideoId(elCard: Element) {
  // Set by the MAIN world grid-tagger on yt-lockup-view-model so isolated world can read it through shadow DOM
  const elLockup = elCard.tagName.toLowerCase() === "yt-lockup-view-model"
    ? elCard
    : elCard.querySelector("yt-lockup-view-model");
  const mainWorldId = elCard.getAttribute("data-ytdl-content-id")
    ?? elLockup?.getAttribute("data-ytdl-content-id");
  if (mainWorldId) {
    return mainWorldId;
  }

  // Polymer Shady DOM patches querySelector so inner shadow content is visible to plain selectors
  const [, contentId] = shadowFirst(elCard, "[class*='content-id-']")?.className.match(/content-id-(\S+)/) ?? [];
  if (contentId) {
    return contentId;
  }

  const elLink = shadowFirst(elCard, "a#video-title-link, a#video-title, a[href*='/watch?v=']");
  if (!(elLink instanceof HTMLAnchorElement)) {
    return null;
  }

  return getVideoIdFromUrl(elLink.href);
}

function mountGridButton({ context, elCard }: {
  context: InstanceType<typeof ContentScriptContext>;
  elCard: Element;
}) {
  const videoId = extractVideoId(elCard);
  if (!videoId) {
    return;
  }

  // Duplicate check: injected container may be inside shadow root
  const isDuplicate = (getLockupRoot(elCard) ?? elCard).querySelector(`[data-ytdl-grid-item="${videoId}"]`);
  if (isDuplicate) {
    return;
  }

  const gridTitle = shadowFirst(elCard, ".ytLockupMetadataViewModelTitle, #video-title-link, #video-title")?.textContent?.trim() ?? "";

  const elItemContainer = document.createElement("div");
  elItemContainer.dataset.ytdlGridItem = videoId;

  const elHost = shadowFirst(elCard, ".ytLockupMetadataViewModelHost");
  if (elHost) {
    elHost.append(elItemContainer);
  } else {
    const elDismissible = shadowFirst(elCard, "#dismissible");
    if (!elDismissible) {
      return;
    }

    const elDetails = elDismissible.querySelector("#details");
    if (elDetails) {
      elDetails.insertAdjacentElement("afterend", elItemContainer);
    } else {
      elDismissible.append(elItemContainer);
    }
  }

  const ui = createIntegratedUi(context, {
    position: "inline",
    anchor: elItemContainer,
    onMount(elUiContainer) {
      mount(PlaylistVideoItem, {
        target: elUiContainer,
        props: {
          videoId,
          gridTitle
        }
      });
    }
  });

  ui.mount();
}

function isCardPending(elCard: Element) {
  const videoId = extractVideoId(elCard);
  if (!videoId) {
    return false;
  }

  return !(getLockupRoot(elCard) ?? elCard).querySelector(`[data-ytdl-grid-item="${videoId}"]`);
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

  for (const elCard of document.querySelectorAll(Selector.VideoCard)) {
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

  const elPageContent = document.querySelector(Selector.PageManager) ?? document.body;
  gridObserver.observe(elPageContent, CHILD_LIST_SUBTREE);
  context.onInvalidated(() => {
    gridObserver?.disconnect();
    visibilityObserver?.disconnect();
  });
}
