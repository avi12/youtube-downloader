import { CHILD_LIST_SUBTREE } from "@/lib/utils/dom";

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

export async function waitForPlaylistHeaderMount(signal: AbortSignal) {
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
