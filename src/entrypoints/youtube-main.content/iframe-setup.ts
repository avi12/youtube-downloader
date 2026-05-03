import { CHILD_LIST_SUBTREE } from "@/lib/utils/dom";
import { ScrubUrlParam } from "@/lib/youtube/youtube-url";

export function setupIframeVideoSilencing() {
  const keepPlaying = location.search.includes(`${ScrubUrlParam.KeepPlaying}=1`);
  const isScrubMode = location.search.includes(`${ScrubUrlParam.ScrubMode}=1`);

  function silenceIframeVideo() {
    const elVideo = document.querySelector<HTMLVideoElement>("video");
    if (!elVideo) {
      return false;
    }

    if (isScrubMode) {
      // Route audio through a gain=0 AudioContext so the player fetches audio
      // SABR tracks when video.muted is set to false by the scrub driver, but
      // no audio actually reaches the speakers. Fallback to muting if the API
      // is unavailable.
      try {
        const audioCtx = new AudioContext();
        void audioCtx.resume();
        const src = audioCtx.createMediaElementSource(elVideo);
        const gain = audioCtx.createGain();
        gain.gain.value = 0;
        src.connect(gain);
        gain.connect(audioCtx.destination);
      } catch {
        elVideo.muted = true;
        elVideo.volume = 0;
      }
      return true;
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
    }>("#movie_player");    if (keepPlaying) {
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
