import PlaylistVideoItem from "@/components/playlist-downloader/PlaylistVideoItem.svelte";
import { CHILD_LIST_SUBTREE } from "@/lib/utils/dom";
import { getVideoIdFromUrl } from "@/lib/youtube/youtube-url";
import { mount } from "svelte";

const PLAYLIST_VIDEO_TAG = "ytd-playlist-video-renderer";

function injectPlaylistVideoItemUi({ context, elVideoItem }: {
  context: InstanceType<typeof ContentScriptContext>;
  elVideoItem: Element;
}) {
  const elVideoIdLink = elVideoItem.querySelector<HTMLAnchorElement>("a#video-title");
  if (!elVideoIdLink) {
    return;
  }

  const videoId = getVideoIdFromUrl(elVideoIdLink.href);
  if (!videoId) {
    return;
  }

  for (const elStale of elVideoItem.querySelectorAll("[data-ytdl-item]")) {
    if (elStale.getAttribute("data-ytdl-item") !== videoId) {
      elStale.remove();
    }
  }

  if (elVideoItem.querySelector(`[data-ytdl-item="${videoId}"]`)) {
    return;
  }

  const elTopLevelActions = elVideoItem.querySelector("ytd-menu-renderer #top-level-buttons-computed");
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

function injectIntoSubtree({ root, context }: {
  root: Element;
  context: InstanceType<typeof ContentScriptContext>;
}) {
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
  const elContents = document.querySelector("ytd-playlist-video-list-renderer #contents");
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
        if (!(node instanceof Element) || !node.hasAttribute("data-ytdl-item")) {
          continue;
        }

        const elParentRenderer = mutation.target instanceof Element
          ? mutation.target.closest(PLAYLIST_VIDEO_TAG)
          : null;
        if (elParentRenderer) {
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
