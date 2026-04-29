import { CHILD_LIST_SUBTREE } from "@/lib/utils/dom";

export function setupIframeVideoSilencing() {
  const keepPlaying = /ytdlKeepPlaying=1/.test(location.search);
  const isScrubMode = /ytdlScrubMode=1/.test(location.search);

  function silenceIframeVideo() {
    const elVideo = document.querySelector<HTMLVideoElement>("video");
    if (!elVideo) {
      return false;
    }

    elVideo.muted = true;
    elVideo.volume = 0;
    elVideo.addEventListener("play", () => {
      elVideo.muted = true;
      elVideo.volume = 0;

      if (keepPlaying && !isScrubMode) {
        elVideo.pause();
      }
    });

    const elPlayer = document.querySelector<HTMLElement & {
      pauseVideo?: () => void;
      stopVideo?: () => void;
    }>("#movie_player");
    if (isScrubMode) {
      return true;
    }

    if (keepPlaying) {
      elPlayer?.pauseVideo?.();
    } else {
      elPlayer?.stopVideo?.();
      elPlayer?.pauseVideo?.();
    }

    return true;
  }

  if (!silenceIframeVideo()) {
    const silenceObserver = new MutationObserver((_, observer) => {
      if (silenceIframeVideo()) {
        observer.disconnect();
      }
    });
    silenceObserver.observe(document.documentElement, CHILD_LIST_SUBTREE);
  }
}
