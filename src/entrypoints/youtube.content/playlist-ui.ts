/**
 * Injects playlist download UI: a header-level "Download All" button
 * and per-video download buttons in playlist video renderers.
 */

import PlaylistDownloader from "@/components/PlaylistDownloader.svelte";
import PlaylistVideoItem from "@/components/PlaylistVideoItem.svelte";
import { getVideoIdFromUrl } from "@/lib/utils";
import type { Options } from "@/types";
import { mount, unmount } from "svelte";

let currentPlaylistUi: ReturnType<typeof mount> | null = null;

export function cleanupPlaylistUi() {
  if (!currentPlaylistUi) {
    return;
  }

  void unmount(currentPlaylistUi);
  currentPlaylistUi = null;

  for (const elItem of document.querySelectorAll("[data-ytdl-playlist-downloader]")) {
    elItem.remove();
  }
}

export function injectPlaylistDownloaderUi(
  context: InstanceType<typeof ContentScriptContext>,
  options: Options
) {
  cleanupPlaylistUi();

  const elHeader = document.querySelector(
    "ytd-playlist-header-renderer, ytd-playlist-sidebar-primary-info-renderer"
  );
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
