import PlaylistVideoItem from "@/components/playlist-downloader/video-item/PlaylistVideoItem.svelte";
import { getVideoIdFromUrl } from "@/lib/youtube/youtube-url";
import { mount } from "svelte";

function getLockupRoot(elCard: Element) {
  const elLockup = elCard.tagName.toLowerCase() === "yt-lockup-view-model"
    ? elCard
    : elCard.querySelector("yt-lockup-view-model");
  return elLockup?.shadowRoot ?? null;
}

export function shadowFirst({ elCard, selector }: {
  elCard: Element;
  selector: string;
}) {
  return getLockupRoot(elCard)?.querySelector(selector) ?? elCard.querySelector(selector);
}

export function extractVideoId(elCard: Element) {
  const elLockup = elCard.tagName.toLowerCase() === "yt-lockup-view-model"
    ? elCard
    : elCard.querySelector("yt-lockup-view-model");
  const mainWorldId = elCard.getAttribute("data-ytdl-content-id")
    ?? elLockup?.getAttribute("data-ytdl-content-id");
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
    selector: "a#video-title-link, a#video-title, a[href*='/watch?v=']"
  });
  if (!(elLink instanceof HTMLAnchorElement)) {
    return null;
  }

  return getVideoIdFromUrl(elLink.href);
}

export const Selector = {
  VideoCard: "yt-lockup-view-model, ytd-rich-item-renderer, ytd-grid-video-renderer",
  PageManager: "ytd-page-manager"
} as const;

export function isCardPending(elCard: Element) {
  const videoId = extractVideoId(elCard);
  if (!videoId) {
    return false;
  }

  return !(getLockupRoot(elCard) ?? elCard).querySelector(`[data-ytdl-grid-item="${videoId}"]`);
}

export function mountGridButton({ context, elCard }: {
  context: InstanceType<typeof ContentScriptContext>;
  elCard: Element;
}) {
  const videoId = extractVideoId(elCard);
  if (!videoId) {
    return;
  }

  const isAlreadyMounted = !!(getLockupRoot(elCard) ?? elCard).querySelector(`[data-ytdl-grid-item="${videoId}"]`);
  if (isAlreadyMounted) {
    return;
  }

  const gridTitle = shadowFirst({
    elCard,
    selector: ".ytLockupMetadataViewModelTitle, #video-title-link, #video-title"
  })?.textContent?.trim() ?? "";
  const elItemContainer = document.createElement("div");
  elItemContainer.dataset.ytdlGridItem = videoId;

  const elHost = shadowFirst({
    elCard,
    selector: ".ytLockupMetadataViewModelHost"
  });
  if (elHost) {
    elHost.append(elItemContainer);
  } else {
    const elDismissible = shadowFirst({
      elCard,
      selector: "#dismissible"
    });
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
