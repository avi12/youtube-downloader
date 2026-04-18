import PlaylistVideoItem from "@/components/playlist-downloader/PlaylistVideoItem.svelte";
import { CHILD_LIST_SUBTREE } from "@/lib/utils/dom";
import { getVideoIdFromUrl } from "@/lib/youtube/youtube-url";
import { mount } from "svelte";

const VIDEO_CARD_SELECTOR = "yt-lockup-view-model, ytd-rich-item-renderer, ytd-grid-video-renderer";
const PAGE_MANAGER_SELECTOR = "ytd-page-manager";
const VIEWPORT_MARGIN = "200px";
// 2 buttons × 36px + 4px gap + 36px three-dot − 10px right-offset of .ytLockupMetadataViewModelMenuButton
const MENU_BUTTON_TITLE_CLEARANCE_PX = 102;

let gridObserver: MutationObserver | null = null;
let visibilityObserver: IntersectionObserver | null = null;

export function cleanupGridUi() {
  gridObserver?.disconnect();
  gridObserver = null;
  visibilityObserver?.disconnect();
  visibilityObserver = null;

  for (const elItem of document.querySelectorAll("[data-ytdl-grid-item]")) {
    const elMenuButton = elItem.closest(".ytLockupMetadataViewModelMenuButton");
    if (elMenuButton instanceof HTMLElement) {
      elMenuButton.style.display = "";
      elMenuButton.style.alignItems = "";
      const elTitle = elMenuButton.closest(".ytLockupMetadataViewModelHost")
        ?.querySelector<HTMLElement>(".ytLockupMetadataViewModelTitle");
      if (elTitle) {
        elTitle.style.paddingInlineEnd = "";
      }
    }

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
  const elMenuButton = elCard.querySelector(".ytLockupMetadataViewModelMenuButton");
  if (elMenuButton) {
    return elMenuButton;
  }

  const elDismissible = elCard.querySelector("#dismissible");
  const elDetails = elDismissible?.querySelector("#details");
  if (elDismissible && elDetails) {
    return elDismissible;
  }

  return null;
}

function mountGridButton({ context, elCard }: {
  context: InstanceType<typeof ContentScriptContext>;
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

  const gridTitle = elCard.querySelector("h3")?.textContent?.trim() ?? "";

  const elItemContainer = document.createElement("div");
  elItemContainer.dataset.ytdlGridItem = videoId;

  if (elAnchor.classList.contains("ytLockupMetadataViewModelMenuButton")) {
    if (elAnchor instanceof HTMLElement) {
      elAnchor.style.display = "flex";
      elAnchor.style.alignItems = "center";
    }

    elAnchor.prepend(elItemContainer);
    const elTitle = elAnchor.closest(".ytLockupMetadataViewModelHost")
      ?.querySelector<HTMLElement>(".ytLockupMetadataViewModelTitle");
    if (elTitle) {
      elTitle.style.paddingInlineEnd = `${MENU_BUTTON_TITLE_CLEARANCE_PX}px`;
    }
  } else {
    const elDetails = elAnchor.querySelector("#details");
    if (elDetails) {
      elDetails.insertAdjacentElement("afterend", elItemContainer);
    } else {
      elAnchor.append(elItemContainer);
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
  return videoId && !elCard.querySelector(`[data-ytdl-grid-item="${videoId}"]`);
}

function createVisibilityObserver(context: InstanceType<typeof ContentScriptContext>) {
  const viewportMarginOptions = { rootMargin: VIEWPORT_MARGIN };
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
    viewportMarginOptions
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
