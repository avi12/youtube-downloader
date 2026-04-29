import { waitForPlaylistHeaderMount } from "./playlist-header";
import { handlePlaylistVideoAdditions } from "./playlist-video-items";
import PlaylistDownloader from "@/components/playlist-downloader/PlaylistDownloader.svelte";
import { checkedPlaylistVideos } from "@/lib/ui/playlist-selection.svelte";
import { CHILD_LIST_SUBTREE } from "@/lib/utils/dom";
import { mount, unmount } from "svelte";

export { handlePlaylistVideoAdditions };

const MOUSE_LEAVE_OPTIONS: MouseEventInit = {
  bubbles: true,
  composed: true
};

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

export async function injectPlaylistDownloaderUi(context: InstanceType<typeof ContentScriptContext>) {
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

  let elHoveredYtdlButton: HTMLElement | null = null;

  function hideYtdlTooltip() {
    document.querySelector<HTMLElement>("yt-tooltip yt-popover")?.hidePopover?.();
    for (const elButton of document.querySelectorAll<HTMLElement>("[data-ytdl-button-id], [data-ytdl-button-id] button")) {
      elButton.dispatchEvent(new MouseEvent("mouseleave", MOUSE_LEAVE_OPTIONS));
    }
  }

  function trackHoveredButton(e: MouseEvent) {
    if (!(e.target instanceof Element)) {
      return;
    }

    const elButton = e.target.closest<HTMLElement>("yt-button-view-model");
    if (!elButton && elHoveredYtdlButton) {
      hideYtdlTooltip();
    }

    elHoveredYtdlButton = elButton;
  }

  function dismissTooltipOnScroll() {
    if (!elHoveredYtdlButton) {
      return;
    }

    elHoveredYtdlButton = null;
    document.querySelector<HTMLElement>("yt-tooltip yt-popover")?.hidePopover?.();
  }

  document.addEventListener("mouseover", trackHoveredButton, { passive: true });
  document.addEventListener("scroll", dismissTooltipOnScroll, {
    capture: true,
    passive: true
  });
  context.onInvalidated(() => {
    document.removeEventListener("mouseover", trackHoveredButton);
    document.removeEventListener("scroll", dismissTooltipOnScroll, { capture: true });
  });

  headerReinjectObserver = new MutationObserver(() => {
    if (document.contains(elMountContainer)) {
      return;
    }

    headerReinjectObserver?.disconnect();
    headerReinjectObserver = null;
    void injectPlaylistDownloaderUi(context);
  });

  headerReinjectObserver.observe(document.body, CHILD_LIST_SUBTREE);
}
