const Selector = {
  PlaylistContents: "ytd-playlist-video-list-renderer #contents",
  PlaylistVideo: "ytd-playlist-video-renderer",
  Continuation: "ytd-continuation-item-renderer"
} as const;

const REVEAL_STABLE_ROUNDS_REQUIRED = 3;
const REVEAL_POLL_INTERVAL_MS = 300;
const REVEAL_MAX_WAIT_MS = 120_000;

function queryPlaylistContents() {
  return document.querySelector(Selector.PlaylistContents);
}

function countRenderedVideos(elContents: Element) {
  return elContents.querySelectorAll(Selector.PlaylistVideo).length;
}

function isMoreAvailable(elContents: Element) {
  return Boolean(elContents.querySelector(Selector.Continuation));
}

function scrollContainerToBottom(elContents: Element) {
  const elLastChild = elContents.lastElementChild;
  const isHtmlElement = elLastChild instanceof HTMLElement;
  if (!isHtmlElement) {
    return;
  }

  elLastChild.scrollIntoView({ block: "end" });
}

async function waitForRoundTransition() {
  await new Promise(resolve => setTimeout(resolve, REVEAL_POLL_INTERVAL_MS));
}

export async function revealAllPlaylistVideos({
  onProgress,
  isAbortRequested
}: {
  onProgress: (update: {
    revealedCount: number;
    isMoreAvailable: boolean;
  }) => void;
  isAbortRequested: () => boolean;
}) {
  const elContents = queryPlaylistContents();
  if (!elContents) {
    return;
  }

  const deadline = Date.now() + REVEAL_MAX_WAIT_MS;
  let stableRounds = 0;
  let lastCount = countRenderedVideos(elContents);
  onProgress({
    revealedCount: lastCount,
    isMoreAvailable: isMoreAvailable(elContents)
  });

  while (Date.now() < deadline) {
    const isAborted = isAbortRequested();
    if (isAborted) {
      return;
    }

    const isNoMoreAvailable = !isMoreAvailable(elContents);
    if (isNoMoreAvailable) {
      return;
    }

    scrollContainerToBottom(elContents);
    await waitForRoundTransition();

    const nextCount = countRenderedVideos(elContents);
    onProgress({
      revealedCount: nextCount,
      isMoreAvailable: isMoreAvailable(elContents)
    });
    const isNewItemsLoaded = nextCount > lastCount;
    if (isNewItemsLoaded) {
      stableRounds = 0;
      lastCount = nextCount;
      continue;
    }

    stableRounds++;
    const isStableRoundsComplete = stableRounds >= REVEAL_STABLE_ROUNDS_REQUIRED;
    if (isStableRoundsComplete) {
      return;
    }
  }
}

export function scrollVideoItemIntoView(videoId: string) {
  const elItemAnchor = document.querySelector(`[data-ytdl-item="${CSS.escape(videoId)}"]`);
  const elPlaylistItem = elItemAnchor?.closest(Selector.PlaylistVideo);
  const isHtmlPlaylistItem = elPlaylistItem instanceof HTMLElement;
  if (!isHtmlPlaylistItem) {
    return;
  }

  elPlaylistItem.scrollIntoView({
    behavior: "smooth",
    block: "center"
  });
}
