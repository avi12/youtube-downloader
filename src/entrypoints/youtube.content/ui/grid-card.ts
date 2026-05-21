import PlaylistVideoItem from "@/components/playlist-downloader/video-item/PlaylistVideoItem.svelte";
import { getVideoIdFromUrl } from "@/lib/youtube/youtube-url";
import { mount } from "svelte";

const LOCKUP_VIEW_MODEL_TAG = "yt-lockup-view-model";
const ATTR_CONTENT_ID = "data-ytdl-content-id";
export const ATTR_GRID_ITEM = "data-ytdl-grid-item";
const SELECTOR_VIDEO_TITLE_LINK = "a#video-title-link, a#video-title, a[href*='/watch?v=']";
const SELECTOR_LOCKUP_METADATA_TITLE = ".ytLockupMetadataViewModelTitle, #video-title-link, #video-title";
const SELECTOR_LOCKUP_METADATA_HOST = ".ytLockupMetadataViewModelHost";
const SELECTOR_DISMISSIBLE = "#dismissible";
const SELECTOR_DETAILS = "#details";

function getLockupRoot(elCard: Element) {
  const isLockupCard = elCard.tagName.toLowerCase() === LOCKUP_VIEW_MODEL_TAG;
  const elLockup = isLockupCard
    ? elCard
    : elCard.querySelector(LOCKUP_VIEW_MODEL_TAG);
  return elLockup?.shadowRoot ?? null;
}

type ShadowFirstParams = {
  elCard: Element;
  selector: string;
};
export function shadowFirst({ elCard, selector }: ShadowFirstParams) {
  return getLockupRoot(elCard)?.querySelector(selector) ?? elCard.querySelector(selector);
}

export function extractVideoId(elCard: Element) {
  const isLockupCard = elCard.tagName.toLowerCase() === LOCKUP_VIEW_MODEL_TAG;
  const elLockup = isLockupCard
    ? elCard
    : elCard.querySelector(LOCKUP_VIEW_MODEL_TAG);
  const mainWorldId = elCard.getAttribute(ATTR_CONTENT_ID)
    ?? elLockup?.getAttribute(ATTR_CONTENT_ID);
  if (mainWorldId) {
    return mainWorldId;
  }

  const [, contentId] = shadowFirst({
    elCard,
    selector: "[class*='content-id-']"
  })?.className.match(/content-id-(\S+)/) ?? [];
  if (contentId) {
    return contentId;
  }

  const elLink = shadowFirst({
    elCard,
    selector: SELECTOR_VIDEO_TITLE_LINK
  });
  if (!(elLink instanceof HTMLAnchorElement)) {
    return null;
  }

  return getVideoIdFromUrl(elLink.href);
}

export const Selector = {
  VideoCard: `${LOCKUP_VIEW_MODEL_TAG}, ytd-rich-item-renderer, ytd-grid-video-renderer`,
  PageManager: "ytd-page-manager"
} as const;

export function isCardPending(elCard: Element) {
  const videoId = extractVideoId(elCard);
  if (!videoId) {
    return false;
  }

  return !(getLockupRoot(elCard) ?? elCard).querySelector(`[${ATTR_GRID_ITEM}="${videoId}"]`);
}

type MountGridButtonParams = {
  context: InstanceType<typeof ContentScriptContext>;
  elCard: Element;
};
export function mountGridButton({ context, elCard }: MountGridButtonParams) {
  const videoId = extractVideoId(elCard);
  if (!videoId) {
    return;
  }

  const isAlreadyMounted = !!(getLockupRoot(elCard) ?? elCard).querySelector(`[${ATTR_GRID_ITEM}="${videoId}"]`);
  if (isAlreadyMounted) {
    return;
  }

  const gridTitle = shadowFirst({
    elCard,
    selector: SELECTOR_LOCKUP_METADATA_TITLE
  })?.textContent?.trim() ?? "";
  const elItemContainer = document.createElement("div");
  elItemContainer.dataset.ytdlGridItem = videoId;

  const elHost = shadowFirst({
    elCard,
    selector: SELECTOR_LOCKUP_METADATA_HOST
  });
  if (elHost) {
    elHost.append(elItemContainer);
  } else {
    const elDismissible = shadowFirst({
      elCard,
      selector: SELECTOR_DISMISSIBLE
    });
    if (!elDismissible) {
      return;
    }

    const elDetails = elDismissible.querySelector(SELECTOR_DETAILS);
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
