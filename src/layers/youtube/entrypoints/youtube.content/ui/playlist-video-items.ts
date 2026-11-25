import { extractVideoId } from "./grid-card";
import { resolveVideoDownloadability } from "./video-downloadability.svelte";
import { checkInterruptedDownload } from "@/layers/youtube/entrypoints/youtube.content/download/interrupted-downloads";
import { CHILD_LIST_SUBTREE } from "@/lib/utils/dom";
import { getVideoIdFromUrl } from "@/lib/youtube/youtube-url";
import PlaylistVideoItem from "#youtube/components/playlist-downloader/video-item/PlaylistVideoItem.svelte";
import { mount, unmount } from "svelte";

const PLAYLIST_VIDEO_TAG = "ytd-playlist-video-renderer";
const LOCKUP_ROW_SELECTOR = "yt-item-section-renderer yt-lockup-view-model";
const ROW_SELECTOR = `${PLAYLIST_VIDEO_TAG}, ${LOCKUP_ROW_SELECTOR}`;
const ATTR_YTDL_ITEM = "data-ytdl-item";
const SELECTOR_VIDEO_ID_LINK = "a#video-title";
const SELECTOR_TOP_LEVEL_BUTTONS = "ytd-menu-renderer #top-level-buttons-computed";
const SELECTOR_LOCKUP_MENU_BUTTON = ".ytLockupMetadataViewModelMenuButton";
const SELECTOR_PLAYLIST_VIDEO_LIST_CONTENTS = "ytd-playlist-video-list-renderer #contents";
const SELECTOR_LOCKUP_LIST_CONTENTS = "yt-section-list-renderer yt-item-section-renderer";

const INTERRUPTED_CHECK_TIMEOUT_MS = 3000;

const pendingMounts = new WeakMap<Element, string>();
const itemUis = new WeakMap<Element, { remove: () => void }>();

// Dropping the container alone leaves its component alive, still answering its buttons' clicks
function removeDetachedItemUis(elRemoved: Element) {
  for (const elItemContainer of [elRemoved, ...elRemoved.querySelectorAll(`[${ATTR_YTDL_ITEM}]`)]) {
    if (!elItemContainer.isConnected) {
      itemUis.get(elItemContainer)?.remove();
    }
  }
}

function whenTimedOut(milliseconds: number) {
  return new Promise<void>(resolve => {
    AbortSignal.timeout(milliseconds).addEventListener("abort", () => resolve(), { once: true });
  });
}

// A stale "interrupted" entry would flash the item amber on its first render, so it is cleared or
// confirmed before mounting, but a background that does not answer must not hold the mount back
async function settleInterruptedState(videoId: string) {
  await Promise.race([
    checkInterruptedDownload(videoId).catch(() => {}),
    whenTimedOut(INTERRUPTED_CHECK_TIMEOUT_MS)
  ]);
}

function extractRowVideoId(elVideoItem: Element) {
  const elVideoIdLink = elVideoItem.querySelector<HTMLAnchorElement>(SELECTOR_VIDEO_ID_LINK);
  return elVideoIdLink ? getVideoIdFromUrl(elVideoIdLink.href) : extractVideoId(elVideoItem);
}

function placeItemContainer({ elVideoItem, elItemContainer }: {
  elVideoItem: Element;
  elItemContainer: HTMLElement;
}) {
  const elTopLevelActions = elVideoItem.querySelector(SELECTOR_TOP_LEVEL_BUTTONS);
  if (elTopLevelActions) {
    elTopLevelActions.append(elItemContainer);
    return true;
  }

  const elLockupMenuButton = elVideoItem.querySelector(SELECTOR_LOCKUP_MENU_BUTTON);
  if (!elLockupMenuButton) {
    return false;
  }

  elLockupMenuButton.before(elItemContainer);
  return true;
}

interface InjectPlaylistVideoItemUiParams {
  context: InstanceType<typeof ContentScriptContext>;
  elVideoItem: Element;
}
async function injectPlaylistVideoItemUi({ context, elVideoItem }: InjectPlaylistVideoItemUiParams) {
  const videoId = extractRowVideoId(elVideoItem);
  if (!videoId) {
    return;
  }

  for (const elStale of elVideoItem.querySelectorAll(`[${ATTR_YTDL_ITEM}]`)) {
    const isStaleItem = elStale.getAttribute(ATTR_YTDL_ITEM) !== videoId;
    if (isStaleItem) {
      itemUis.get(elStale)?.remove();
    }
  }

  const isAlreadyMounted = !!elVideoItem.querySelector(`[${ATTR_YTDL_ITEM}="${videoId}"]`);
  const isMountPending = pendingMounts.get(elVideoItem) === videoId;
  if (isAlreadyMounted || isMountPending) {
    return;
  }

  pendingMounts.set(elVideoItem, videoId);
  const isDownloadable = await resolveVideoDownloadability(videoId);
  if (isDownloadable) {
    await settleInterruptedState(videoId);
  }

  const isStillPending = pendingMounts.get(elVideoItem) === videoId;
  pendingMounts.delete(elVideoItem);
  const isStillCurrent = isStillPending && elVideoItem.isConnected && extractRowVideoId(elVideoItem) === videoId;
  if (!isDownloadable || !isStillCurrent) {
    return;
  }

  const elItemContainer = document.createElement("div");
  elItemContainer.dataset.ytdlItem = videoId;
  const isPlaced = placeItemContainer({
    elVideoItem,
    elItemContainer
  });
  if (!isPlaced) {
    return;
  }

  const integratedUi = createIntegratedUi(context, {
    position: "inline",
    anchor: elItemContainer,
    onMount(elUiContainer) {
      return mount(PlaylistVideoItem, {
        target: elUiContainer,
        props: {
          videoId,
          isPlaylistItem: true
        }
      });
    },
    onRemove(component) {
      if (component) {
        unmount(component).catch(() => {});
      }

      // An invalidated run's leftover container would pass for a mounted item in the next run
      elItemContainer.remove();
    }
  });

  integratedUi.mount();
  itemUis.set(elItemContainer, integratedUi);
}

interface InjectIntoSubtreeParams {
  root: Element;
  context: InstanceType<typeof ContentScriptContext>;
}
function injectIntoSubtree({ root, context }: InjectIntoSubtreeParams) {
  if (root.matches(ROW_SELECTOR)) {
    injectPlaylistVideoItemUi({
      context,
      elVideoItem: root
    }).catch(() => {});
  }

  for (const elVideoItem of root.querySelectorAll(ROW_SELECTOR)) {
    injectPlaylistVideoItemUi({
      context,
      elVideoItem
    }).catch(() => {});
  }

  const elParentRenderer = root.closest(ROW_SELECTOR);
  if (elParentRenderer) {
    injectPlaylistVideoItemUi({
      context,
      elVideoItem: elParentRenderer
    }).catch(() => {});
  }
}

function findRowsContainer() {
  return document.querySelector(SELECTOR_PLAYLIST_VIDEO_LIST_CONTENTS)
    ?? document.querySelector(SELECTOR_LOCKUP_LIST_CONTENTS);
}

interface ObserveRowsParams {
  context: InstanceType<typeof ContentScriptContext>;
  elContents: Element;
}
function observeRows({ context, elContents }: ObserveRowsParams) {
  injectIntoSubtree({
    root: elContents,
    context
  });

  const mutationObserver = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        const isElementNode = node instanceof Element;
        if (isElementNode) {
          injectIntoSubtree({
            root: node,
            context
          });
        }
      }

      for (const node of mutation.removedNodes) {
        const isElementNode = node instanceof Element;
        if (!isElementNode) {
          continue;
        }

        removeDetachedItemUis(node);
        const isForeignNode = !node.hasAttribute(ATTR_YTDL_ITEM);
        if (isForeignNode) {
          continue;
        }

        const elParentRenderer = mutation.target instanceof Element
          ? mutation.target.closest(ROW_SELECTOR)
          : null;
        const hasParentRenderer = !!elParentRenderer;
        if (hasParentRenderer) {
          injectPlaylistVideoItemUi({
            context,
            elVideoItem: elParentRenderer
          }).catch(() => {});
        }
      }
    }
  });

  mutationObserver.observe(elContents, CHILD_LIST_SUBTREE);
  context.onInvalidated(() => mutationObserver.disconnect());
}

export function handlePlaylistVideoAdditions(context: InstanceType<typeof ContentScriptContext>) {
  const elContents = findRowsContainer();
  if (elContents) {
    observeRows({
      context,
      elContents
    });
    return;
  }

  const bodyObserver = new MutationObserver(() => {
    const elLateContents = findRowsContainer();
    if (!elLateContents) {
      return;
    }

    bodyObserver.disconnect();
    observeRows({
      context,
      elContents: elLateContents
    });
  });
  bodyObserver.observe(document.body, CHILD_LIST_SUBTREE);
  context.onInvalidated(() => bodyObserver.disconnect());
}
