import PlaylistVideoItem from "@/components/playlist-downloader/video-item/PlaylistVideoItem.svelte";
import PlaylistGridItem from "@/components/playlist-grid-item/PlaylistGridItem.svelte";
import { getVideoIdFromUrl } from "@/lib/youtube/youtube-url";
import type { Prettify } from "@/types";
import { mount } from "svelte";

const LOCKUP_VIEW_MODEL_TAG = "yt-lockup-view-model";
const ATTR_CONTENT_ID = "data-ytdl-content-id";
export const ATTR_GRID_ITEM = "data-ytdl-grid-item";
const SELECTOR_VIDEO_TITLE_LINK = "a#video-title-link, a#video-title, a[href*='/watch?v=']";
const SELECTOR_LOCKUP_METADATA_TITLE = ".ytLockupMetadataViewModelTitle, #video-title-link, #video-title";
const SELECTOR_LOCKUP_METADATA_HOST = ".ytLockupMetadataViewModelHost";
const SELECTOR_LOCKUP_HOST = ".ytLockupViewModelHost";
const SELECTOR_DISMISSIBLE = "#dismissible";
const SELECTOR_DETAILS = "#details";
const SELECTOR_TITLE_WRAPPER_MENU = "#title-wrapper #menu";
const SELECTOR_CONTENT_ID_CLASS = "[class*='content-id-']";
const SELECTOR_AD_INDICATOR = "feed-ad-metadata-view-model, ad-avatar-view-model, ytd-ad-slot-renderer, ytd-display-ad-renderer, ytd-promoted-sparkles-web-renderer, [class*='ytwFeedAdMetadataViewModel'], [class*='ytwAdAvatarViewModel']";
const PLAYLIST_ID_PREFIXES = ["PL", "LL", "FL", "OL", "RD", "UU", "UL", "EL", "VL"];

export const CardKind = {
  Video: "video",
  Playlist: "playlist"
} as const;
export type CardKind = (typeof CardKind)[keyof typeof CardKind];

export type CardContent = Prettify<
  | {
    kind: typeof CardKind.Video;
    videoId: string;
  }
  | {
    kind: typeof CardKind.Playlist;
    playlistId: string;
  }
>;

function isPlaylistId(id: string) {
  return PLAYLIST_ID_PREFIXES.some(prefix => id.startsWith(prefix));
}

function isAdCard(elCard: Element) {
  return !!elCard.querySelector(SELECTOR_AD_INDICATOR);
}

function getLockupRoot(elCard: Element) {
  const isLockupCard = elCard.tagName.toLowerCase() === LOCKUP_VIEW_MODEL_TAG;
  const elLockup = isLockupCard
    ? elCard
    : elCard.querySelector(LOCKUP_VIEW_MODEL_TAG);
  return elLockup?.shadowRoot ?? null;
}

function getLockupLight(elCard: Element) {
  const isLockupCard = elCard.tagName.toLowerCase() === LOCKUP_VIEW_MODEL_TAG;
  return isLockupCard ? elCard : elCard.querySelector(LOCKUP_VIEW_MODEL_TAG);
}

type ShadowFirstParams = Prettify<{
  elCard: Element;
  selector: string;
}>;
export function shadowFirst({ elCard, selector }: ShadowFirstParams) {
  return getLockupRoot(elCard)?.querySelector(selector) ?? elCard.querySelector(selector);
}

function extractContentIdFromClass(elCard: Element) {
  const elLockup = getLockupLight(elCard);
  const elWithContentId = elLockup?.querySelector(SELECTOR_CONTENT_ID_CLASS)
    ?? getLockupRoot(elCard)?.querySelector(SELECTOR_CONTENT_ID_CLASS)
    ?? elCard.querySelector(SELECTOR_CONTENT_ID_CLASS);
  const [, contentId] = elWithContentId?.className.match(/content-id-(\S+)/) ?? [];
  return contentId ?? null;
}

export function extractCardContent(elCard: Element): CardContent | null {
  if (isAdCard(elCard)) {
    return null;
  }

  const contentIdFromClass = extractContentIdFromClass(elCard);
  if (contentIdFromClass) {
    return isPlaylistId(contentIdFromClass)
      ? {
        kind: CardKind.Playlist,
        playlistId: contentIdFromClass
      }
      : {
        kind: CardKind.Video,
        videoId: contentIdFromClass
      };
  }

  const elLockup = getLockupLight(elCard);
  const mainWorldId = elCard.getAttribute(ATTR_CONTENT_ID)
    ?? elLockup?.getAttribute(ATTR_CONTENT_ID);
  if (mainWorldId) {
    return isPlaylistId(mainWorldId)
      ? {
        kind: CardKind.Playlist,
        playlistId: mainWorldId
      }
      : {
        kind: CardKind.Video,
        videoId: mainWorldId
      };
  }

  const elLink = shadowFirst({
    elCard,
    selector: SELECTOR_VIDEO_TITLE_LINK
  });
  if (!(elLink instanceof HTMLAnchorElement)) {
    return null;
  }

  const videoId = getVideoIdFromUrl(elLink.href);
  return videoId ? {
    kind: CardKind.Video,
    videoId
  } : null;
}

export function extractVideoId(elCard: Element) {
  const content = extractCardContent(elCard);
  return content?.kind === CardKind.Video ? content.videoId : null;
}

export const Selector = {
  VideoCard: `${LOCKUP_VIEW_MODEL_TAG}, ytd-rich-item-renderer, ytd-grid-video-renderer, ytd-video-renderer`,
  PageManager: "ytd-page-manager"
} as const;

function getContentKey(content: CardContent) {
  return content.kind === CardKind.Video ? content.videoId : content.playlistId;
}

export function isCardPending(elCard: Element) {
  const content = extractCardContent(elCard);
  if (!content) {
    return false;
  }

  const key = getContentKey(content);
  return !(getLockupRoot(elCard) ?? elCard).querySelector(`[${ATTR_GRID_ITEM}="${key}"]`);
}

function resolveMountPoint(elCard: Element) {
  const elMetadataHost = shadowFirst({
    elCard,
    selector: SELECTOR_LOCKUP_METADATA_HOST
  });
  if (elMetadataHost) {
    return {
      elTarget: elMetadataHost,
      position: "append"
    } as const;
  }

  const elLockupHost = shadowFirst({
    elCard,
    selector: SELECTOR_LOCKUP_HOST
  });
  if (elLockupHost) {
    return {
      elTarget: elLockupHost,
      position: "append"
    } as const;
  }

  const elDismissible = shadowFirst({
    elCard,
    selector: SELECTOR_DISMISSIBLE
  });
  if (!elDismissible) {
    return null;
  }

  const elDetails = elDismissible.querySelector(SELECTOR_DETAILS);
  if (elDetails) {
    return {
      elTarget: elDetails,
      position: "after"
    } as const;
  }

  const elTitleWrapperMenu = elDismissible.querySelector(SELECTOR_TITLE_WRAPPER_MENU);
  if (elTitleWrapperMenu) {
    return {
      elTarget: elTitleWrapperMenu,
      position: "before"
    } as const;
  }

  return {
    elTarget: elDismissible,
    position: "append"
  } as const;
}

type MountGridButtonParams = {
  context: InstanceType<typeof ContentScriptContext>;
  elCard: Element;
};
export function mountGridButton({ context, elCard }: MountGridButtonParams) {
  const content = extractCardContent(elCard);
  if (!content) {
    return false;
  }

  const key = getContentKey(content);
  const isAlreadyMounted = !!(getLockupRoot(elCard) ?? elCard).querySelector(`[${ATTR_GRID_ITEM}="${key}"]`);
  if (isAlreadyMounted) {
    return true;
  }

  const mountPoint = resolveMountPoint(elCard);
  if (!mountPoint) {
    return false;
  }

  const gridTitle = shadowFirst({
    elCard,
    selector: SELECTOR_LOCKUP_METADATA_TITLE
  })?.textContent?.trim() ?? "";

  const elItemContainer = document.createElement("div");
  elItemContainer.dataset.ytdlGridItem = key;

  if (mountPoint.position === "after") {
    mountPoint.elTarget.insertAdjacentElement("afterend", elItemContainer);
  } else if (mountPoint.position === "before") {
    mountPoint.elTarget.insertAdjacentElement("beforebegin", elItemContainer);
  } else {
    mountPoint.elTarget.append(elItemContainer);
  }

  const ui = createIntegratedUi(context, {
    position: "inline",
    anchor: elItemContainer,
    onMount(elUiContainer) {
      if (content.kind === CardKind.Playlist) {
        mount(PlaylistGridItem, {
          target: elUiContainer,
          props: {
            playlistId: content.playlistId,
            gridTitle
          }
        });
        return;
      }

      mount(PlaylistVideoItem, {
        target: elUiContainer,
        props: {
          videoId: content.videoId,
          gridTitle
        }
      });
    }
  });
  ui.mount();
  return true;
}
