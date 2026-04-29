import PlaylistVideoItem from "@/components/playlist-downloader/PlaylistVideoItem.svelte";
import { getVideoIdFromUrl } from "@/lib/youtube/youtube-url";
import { mount } from "svelte";

const VIDEO_CARD_SELECTOR = "yt-lockup-view-model, ytd-rich-item-renderer, ytd-grid-video-renderer";

export { VIDEO_CARD_SELECTOR };

function extractVideoId(elCard: Element) {
  const contentIdMatch = elCard.querySelector("[class*='content-id-']")?.className.match(/content-id-(\S+)/);
  if (contentIdMatch) {
    return contentIdMatch[1];
  }

  const elLink = elCard.querySelector<HTMLAnchorElement>("a#video-title-link, a#video-title");
  if (!elLink) {
    return null;
  }

  return getVideoIdFromUrl(elLink.href);
}

export function isCardPending(elCard: Element) {
  const videoId = extractVideoId(elCard);
  return videoId && !elCard.querySelector(`[data-ytdl-grid-item="${videoId}"]`);
}

export function mountGridButton({
  context,
  elCard
}: {
  context: InstanceType<typeof ContentScriptContext>;
  elCard: Element;
}) {
  const videoId = extractVideoId(elCard);
  if (!videoId || elCard.querySelector(`[data-ytdl-grid-item="${videoId}"]`)) {
    return;
  }

  const gridTitle = elCard.querySelector(
    ".ytLockupMetadataViewModelTitle, #video-title-link, #video-title"
  )?.textContent?.trim() ?? "";

  const elItemContainer = document.createElement("div");
  elItemContainer.dataset.ytdlGridItem = videoId;

  const elHost = elCard.querySelector(".ytLockupMetadataViewModelHost");
  if (elHost) {
    elHost.append(elItemContainer);
  } else {
    const elDismissible = elCard.querySelector("#dismissible");
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
