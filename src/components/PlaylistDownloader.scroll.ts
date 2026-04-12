const PLAYLIST_CONTENTS_SELECTOR = "ytd-playlist-video-list-renderer #contents";
const PLAYLIST_VIDEO_TAG = "ytd-playlist-video-renderer";
const CONTINUATION_TAG = "ytd-continuation-item-renderer";

const revealStableRoundsRequired = 3;
const revealPollIntervalMs = 300;
const revealMaxWaitMs = 120_000;

function queryPlaylistContents() {
  return document.querySelector(PLAYLIST_CONTENTS_SELECTOR);
}

function countRenderedVideos(elContents: Element) {
  return elContents.querySelectorAll(PLAYLIST_VIDEO_TAG).length;
}

function hasMoreToLoad(elContents: Element) {
  return Boolean(elContents.querySelector(CONTINUATION_TAG));
}

function scrollContainerToBottom(elContents: Element) {
  const elLastChild = elContents.lastElementChild;
  if (!(elLastChild instanceof HTMLElement)) {
    return;
  }

  elLastChild.scrollIntoView({ block: "end" });
}

async function waitForRoundTransition() {
  await new Promise(resolve => setTimeout(resolve, revealPollIntervalMs));
}

export type RevealProgressUpdate = {
  revealedCount: number;
  hasMore: boolean;
};

/**
 * Scrolls the playlist container until no new video renderers appear for
 * several consecutive polls. YouTube's infinite-scroll loads in batches of
 * ~100 when the continuation sentinel enters the viewport, so repeatedly
 * scrolling to the bottom triggers the next batch. Guards against the
 * stall case by requiring multiple stable rounds before giving up.
 */
export async function revealAllPlaylistVideos(
  onProgress: (update: RevealProgressUpdate) => void,
  shouldAbort: () => boolean
) {
  const elContents = queryPlaylistContents();
  if (!elContents) {
    return;
  }

  const deadline = Date.now() + revealMaxWaitMs;
  let stableRounds = 0;
  let lastCount = countRenderedVideos(elContents);
  onProgress({ revealedCount: lastCount, hasMore: hasMoreToLoad(elContents) });

  while (Date.now() < deadline) {
    if (shouldAbort()) {
      return;
    }

    if (!hasMoreToLoad(elContents)) {
      return;
    }

    scrollContainerToBottom(elContents);
    await waitForRoundTransition();

    const nextCount = countRenderedVideos(elContents);
    onProgress({ revealedCount: nextCount, hasMore: hasMoreToLoad(elContents) });

    if (nextCount > lastCount) {
      stableRounds = 0;
      lastCount = nextCount;
      continue;
    }

    stableRounds++;

    if (stableRounds >= revealStableRoundsRequired) {
      return;
    }
  }
}

export function scrollVideoItemIntoView(videoId: string) {
  const elItemAnchor = document.querySelector(`[data-ytdl-item="${CSS.escape(videoId)}"]`);
  const elPlaylistItem = elItemAnchor?.closest(PLAYLIST_VIDEO_TAG);
  if (!(elPlaylistItem instanceof HTMLElement)) {
    return;
  }

  elPlaylistItem.scrollIntoView({ behavior: "smooth", block: "center" });
}
