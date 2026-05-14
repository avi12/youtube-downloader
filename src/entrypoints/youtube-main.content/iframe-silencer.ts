import { CHILD_LIST_SUBTREE } from "@/lib/utils/dom";
import { getMoviePlayer } from "@/lib/youtube/movie-player";

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
  });

  const elPlayer = getMoviePlayer();
  elPlayer?.stopVideo?.();
  elPlayer?.pauseVideo?.();
  return true;
}

export function setupIframeSilencer() {
  if (silenceIframeVideo()) {
    return;
  }

  const silenceObserver = new MutationObserver((_, observer) => {
    if (silenceIframeVideo()) {
      observer.disconnect();
    }
  });
  silenceObserver.observe(document.documentElement, CHILD_LIST_SUBTREE);
}
