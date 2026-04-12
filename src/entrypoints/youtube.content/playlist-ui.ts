/**
 * Injects playlist download UI: a header-level "Download All" button
 * and per-video download buttons in playlist video renderers.
 */

import PlaylistDownloader from "@/components/PlaylistDownloader.svelte";
import PlaylistVideoItem from "@/components/PlaylistVideoItem.svelte";
import { checkedPlaylistVideos } from "@/lib/playlist-selection.svelte";
import { getVideoIdFromUrl } from "@/lib/utils";
import type { Options } from "@/types";
import { mount, unmount } from "svelte";

let currentPlaylistUi: ReturnType<typeof mount> | null = null;
let headerMountAbort: AbortController | null = null;

export function cleanupPlaylistUi() {
  headerMountAbort?.abort();
  headerMountAbort = null;

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

    observer.observe(document.body, { childList: true, subtree: true });

    signal.addEventListener("abort", () => {
      observer.disconnect();
      resolve(null);
    }, { once: true });
  });
}

function findPlaylistHeaderMount() {
  // YouTube renders several duplicate page-header instances (legacy, responsive,
  // hidden). Target the flex-actions row that's actually visible on screen, then
  // mount into its parent (.ytPageHeaderViewModelHeadlineInfo).
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
  context: InstanceType<typeof ContentScriptContext>,
  options: Options
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
      currentPlaylistUi = mount(PlaylistDownloader, {
        target: elUiContainer,
        props: { options }
      });
    }
  });

  ui.mount();
}

function injectPlaylistVideoItemUi({ context, options, elVideoItem }: {
  context: InstanceType<typeof ContentScriptContext>;
  options: Options;
  elVideoItem: Element;
}) {
  const elVideoIdLink = elVideoItem.querySelector<HTMLAnchorElement>("a#video-title");
  if (!elVideoIdLink) {
    return;
  }

  const videoId = getVideoIdFromUrl(elVideoIdLink.href);
  if (!videoId || elVideoItem.querySelector(`[data-ytdl-item="${videoId}"]`)) {
    return;
  }

  const elMenu = elVideoItem.querySelector("ytd-menu-renderer");
  if (!elMenu) {
    return;
  }

  const elItemContainer = document.createElement("div");
  elItemContainer.dataset.ytdlItem = videoId;
  elMenu.append(elItemContainer);

  const ui = createIntegratedUi(context, {
    position: "inline",
    anchor: elItemContainer,
    onMount(elUiContainer) {
      mount(PlaylistVideoItem, {
        target: elUiContainer,
        props: {
          videoId,
          isPlaylistItem: true,
          options
        }
      });
    }
  });

  ui.mount();
}

export function handlePlaylistVideoAdditions(
  context: InstanceType<typeof ContentScriptContext>,
  options: Options
) {
  const elContents = document.querySelector("ytd-playlist-video-list-renderer #contents");
  if (!elContents) {
    return;
  }

  for (const elVideoItem of elContents.querySelectorAll("ytd-playlist-video-renderer")) {
    injectPlaylistVideoItemUi({ context, options, elVideoItem });
  }

  const mutationObserver = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node instanceof HTMLElement && node.tagName.toLowerCase() === "ytd-playlist-video-renderer") {
          injectPlaylistVideoItemUi({
            context,
            options,
            elVideoItem: node
          });
        }
      }
    }
  });

  mutationObserver.observe(elContents, { childList: true });
  context.onInvalidated(() => mutationObserver.disconnect());
}
