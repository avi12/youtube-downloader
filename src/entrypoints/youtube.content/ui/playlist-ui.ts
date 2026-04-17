import PlaylistDownloader from "@/components/playlist-downloader/PlaylistDownloader.svelte";
import PlaylistVideoItem from "@/components/playlist-downloader/PlaylistVideoItem.svelte";
import { checkedPlaylistVideos } from "@/lib/ui/playlist-selection.svelte";
import { getVideoIdFromUrl } from "@/lib/youtube/youtube-url";
import { mount, unmount } from "svelte";

let currentPlaylistUi: ReturnType<typeof mount> | null = null;
let headerMountAbort: AbortController | null = null;
let headerReinjectObserver: MutationObserver | null = null;

export function cleanupPlaylistUi() {
  headerMountAbort?.abort();
  headerMountAbort = null;

  headerReinjectObserver?.disconnect();
  headerReinjectObserver = null;

  if (currentPlaylistUi) {
    void unmount(currentPlaylistUi);
    currentPlaylistUi = null;
  }

  checkedPlaylistVideos.clear();

  for (const elItem of document.querySelectorAll("[data-ytdl-playlist-downloader]")) {
    elItem.remove();
  }
}

function waitForPlaylistHeaderMount(signal: AbortSignal) {
  return new Promise<HTMLElement | null>(resolve => {
    const initial = findPlaylistHeaderMount();
    if (initial) {
      resolve(initial);
      return;
    }

    const observer = new MutationObserver(() => {
      const elHeader = findPlaylistHeaderMount();
      if (!elHeader) {
        return;
      }

      observer.disconnect();
      resolve(elHeader);
    });

    const childListSubtreeOptions = {
      childList: true,
      subtree: true
    };
    observer.observe(document.body, childListSubtreeOptions);

    signal.addEventListener("abort", () => {
      observer.disconnect();
      resolve(null);
    }, { once: true });
  });
}

function findPlaylistHeaderMount() {
  // YouTube renders duplicate page-header instances (legacy, responsive, hidden);
  // target the flex-actions row that's actually visible.
  for (const elFlex of document.querySelectorAll<HTMLElement>("yt-flexible-actions-view-model")) {
    if (elFlex.getBoundingClientRect().height <= 0) {
      continue;
    }

    const elHeadline = elFlex.closest<HTMLElement>(".ytPageHeaderViewModelHeadlineInfo");
    if (elHeadline) {
      return elHeadline;
    }
  }

  for (const elHeader of document.querySelectorAll<HTMLElement>(
    "ytd-playlist-header-renderer, ytd-playlist-sidebar-primary-info-renderer"
  )) {
    if (elHeader.getBoundingClientRect().height > 0) {
      return elHeader;
    }
  }

  return null;
}

export async function injectPlaylistDownloaderUi(
  context: InstanceType<typeof ContentScriptContext>
) {
  cleanupPlaylistUi();

  headerMountAbort = new AbortController();
  const elHeader = await waitForPlaylistHeaderMount(headerMountAbort.signal);
  if (!elHeader) {
    return;
  }

  const elMountContainer = document.createElement("div");
  elMountContainer.dataset.ytdlPlaylistDownloader = "true";
  elHeader.append(elMountContainer);

  const ui = createIntegratedUi(context, {
    position: "inline",
    anchor: elMountContainer,
    onMount(elUiContainer) {
      currentPlaylistUi = mount(PlaylistDownloader, { target: elUiContainer });
    }
  });

  ui.mount();

  function dismissYtdlTooltips() {
    for (const elButton of document.querySelectorAll<HTMLElement>("[data-ytdl-button-id]")) {
      elButton.dispatchEvent(new MouseEvent("mouseleave", { bubbles: true }));
    }
  }

  document.addEventListener("scroll", dismissYtdlTooltips, true);
  context.onInvalidated(() => document.removeEventListener("scroll", dismissYtdlTooltips, true));

  // YouTube rebuilds the header subtree on theme transitions (and some other
  // SPA re-renders), which detaches our mount container. Re-inject when that
  // happens so the panel survives.
  headerReinjectObserver = new MutationObserver(() => {
    if (document.contains(elMountContainer)) {
      return;
    }

    headerReinjectObserver?.disconnect();
    headerReinjectObserver = null;
    void injectPlaylistDownloaderUi(context);
  });

  const childListSubtreeOptions = {
    childList: true,
    subtree: true
  };
  headerReinjectObserver.observe(document.body, childListSubtreeOptions);
}

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

  // When a renderer is recycled for a different video, the previous video's
  // container is still in the DOM. Remove it before injecting the new one so
  // the old Svelte component is cleaned up and doesn't clutter the menu.
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

const PLAYLIST_VIDEO_TAG = "ytd-playlist-video-renderer";

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

  // Polymer lazily renders #top-level-buttons-computed inside ytd-menu-renderer.
  // If the renderer was added before that element existed, injection was skipped.
  // When the subtree mutation fires for a child node, retry the nearest renderer.
  // No pre-check here: injectPlaylistVideoItemUi does the per-videoId dedup, and
  // a broad querySelector("[data-ytdl-item]") check would falsely skip recycled
  // renderers that still carry a stale container from a previous video.
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

      // Polymer's virtual DOM sync can remove our injected container from
      // #top-level-buttons-computed without adding any replacement node,
      // so no addedNodes event fires and the retry logic never triggers.
      // Detect that case here and re-inject immediately.
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

  const childListSubtreeOptions = {
    childList: true,
    subtree: true
  };
  mutationObserver.observe(elContents, childListSubtreeOptions);
  context.onInvalidated(() => mutationObserver.disconnect());
}
