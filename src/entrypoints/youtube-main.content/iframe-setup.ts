import { CHILD_LIST_SUBTREE } from "@/lib/utils/dom";
import { ScrubUrlParam } from "@/lib/youtube/youtube-url";

export function setupIframeVideoSilencing() {
  const keepPlaying = location.search.includes(`${ScrubUrlParam.KeepPlaying}=1`);

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

      if (keepPlaying) {
        elVideo.pause();
      }
    });

    const elPlayer = document.querySelector<HTMLElement & {
      pauseVideo?: () => void;
      stopVideo?: () => void;
    }>("#movie_player");
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
