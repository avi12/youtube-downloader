import PlaylistVideoItem from "@/components/playlist-downloader/video-item/PlaylistVideoItem.svelte";
import { CHILD_LIST_SUBTREE } from "@/lib/utils/dom";
import { getVideoIdFromUrl } from "@/lib/youtube/youtube-url";
import { mount } from "svelte";

const PLAYLIST_VIDEO_TAG = "ytd-playlist-video-renderer";
const ATTR_YTDL_ITEM = "data-ytdl-item";
const SELECTOR_VIDEO_ID_LINK = "a#video-title";
const SELECTOR_TOP_LEVEL_BUTTONS = "ytd-menu-renderer #top-level-buttons-computed";
const SELECTOR_PLAYLIST_VIDEO_LIST_CONTENTS = "ytd-playlist-video-list-renderer #contents";

type InjectPlaylistVideoItemUiParams = {
  context: InstanceType<typeof ContentScriptContext>;
  elVideoItem: Element;
};
function injectPlaylistVideoItemUi({ context, elVideoItem }: InjectPlaylistVideoItemUiParams) {
  const elVideoIdLink = elVideoItem.querySelector<HTMLAnchorElement>(SELECTOR_VIDEO_ID_LINK);
  if (!elVideoIdLink) {
    return;
  }

  const videoId = getVideoIdFromUrl(elVideoIdLink.href);
  if (!videoId) {
    return;
  }

  for (const elStale of elVideoItem.querySelectorAll(`[${ATTR_YTDL_ITEM}]`)) {
    const isStaleItem = elStale.getAttribute(ATTR_YTDL_ITEM) !== videoId;
    if (isStaleItem) {
      elStale.remove();
    }
  }

  const isAlreadyMounted = !!elVideoItem.querySelector(`[${ATTR_YTDL_ITEM}="${videoId}"]`);
  if (isAlreadyMounted) {
    return;
  }

  const elTopLevelActions = elVideoItem.querySelector(SELECTOR_TOP_LEVEL_BUTTONS);
  if (!elTopLevelActions) {
    return;
  }

  const elItemContainer = document.createElement("div");
  elItemContainer.dataset.ytdlItem = videoId;
  elTopLevelActions.append(elItemContainer);

  const ui = createIntegratedUi(context, {
    position: "inline",
    anchor: elItemContainer,
    onMount(elUiContainer) {
      mount(PlaylistVideoItem, {
        target: elUiContainer,
        props: {
          videoId,
          isPlaylistItem: true
        }
      });
    }
  });

  ui.mount();
}

type InjectIntoSubtreeParams = {
  root: Element;
  context: InstanceType<typeof ContentScriptContext>;
};
function injectIntoSubtree({ root, context }: InjectIntoSubtreeParams) {
  if (root.tagName.toLowerCase() === PLAYLIST_VIDEO_TAG) {
    injectPlaylistVideoItemUi({
      context,
      elVideoItem: root
    });
  }

  for (const elVideoItem of root.querySelectorAll(PLAYLIST_VIDEO_TAG)) {
    injectPlaylistVideoItemUi({
      context,
      elVideoItem
    });
  }

  const elParentRenderer = root.closest(PLAYLIST_VIDEO_TAG);
  if (elParentRenderer) {
    injectPlaylistVideoItemUi({
      context,
      elVideoItem: elParentRenderer
    });
  }
}

export function handlePlaylistVideoAdditions(context: InstanceType<typeof ContentScriptContext>) {
  const elContents = document.querySelector(SELECTOR_PLAYLIST_VIDEO_LIST_CONTENTS);
  if (!elContents) {
    return;
  }

  injectIntoSubtree({
    root: elContents,
    context
  });

  const mutationObserver = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node instanceof Element) {
          injectIntoSubtree({
            root: node,
            context
          });
        }
      }

      for (const node of mutation.removedNodes) {
        if (!(node instanceof Element) || !node.hasAttribute(ATTR_YTDL_ITEM)) {
          continue;
        }

        const elParentRenderer = mutation.target instanceof Element
          ? mutation.target.closest(PLAYLIST_VIDEO_TAG)
          : null;
        const hasParentRenderer = !!elParentRenderer;
        if (hasParentRenderer) {
          injectPlaylistVideoItemUi({
            context,
            elVideoItem: elParentRenderer
          });
        }
      }
    }
  });

  mutationObserver.observe(elContents, CHILD_LIST_SUBTREE);
  context.onInvalidated(() => mutationObserver.disconnect());
}
