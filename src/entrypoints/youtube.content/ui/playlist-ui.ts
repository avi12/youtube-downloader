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

function findPlaylistHeaderMount() {
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

    observer.observe(document.body, CHILD_LIST_SUBTREE);

    signal.addEventListener("abort", () => {
      observer.disconnect();
      resolve(null);
    }, { once: true });
  });
}

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

function hideYtdlTooltip() {
  document.querySelector<HTMLElement>("yt-tooltip yt-popover")?.hidePopover?.();
  for (const elButton of document.querySelectorAll<HTMLElement>(
    "[data-ytdl-button-id], [data-ytdl-button-id] button"
  )) {
    elButton.dispatchEvent(new MouseEvent("mouseleave", MOUSE_LEAVE_OPTIONS));
  }
}

function makeTooltipHandlers() {
  let elHoveredYtdlButton: HTMLElement | null = null;

  function trackHoveredButton(e: MouseEvent) {
    const isNotElement = !(e.target instanceof Element);
    if (isNotElement) {
      return;
    }

    const elButton = e.target.closest<HTMLElement>("yt-button-view-model");
    const isLeavingYtdlButton = !elButton && elHoveredYtdlButton;
    if (isLeavingYtdlButton) {
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

  return {
    trackHoveredButton,
    dismissTooltipOnScroll
  };
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

  const { trackHoveredButton, dismissTooltipOnScroll } = makeTooltipHandlers();

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
    const isMountContainerPresent = document.contains(elMountContainer);
    if (isMountContainerPresent) {
      return;
    }

    headerReinjectObserver?.disconnect();
    headerReinjectObserver = null;
    void injectPlaylistDownloaderUi(context);
  });

  headerReinjectObserver.observe(document.body, CHILD_LIST_SUBTREE);
}
