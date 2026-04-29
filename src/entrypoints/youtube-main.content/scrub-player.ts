import { MOVIE_PLAYER_SELECTOR, VIDEO_ELEMENT_SELECTOR } from "@/lib/youtube/player-selectors";

export const POLL_INTERVAL_MS = 250;
const PLAYER_READY_TIMEOUT_MS = 15_000;
const PLAYBACK_START_TIMEOUT_MS = 15_000;

export interface MoviePlayer extends HTMLElement {
  playVideo?: () => void;
  pauseVideo?: () => void;
  stopVideo?: () => void;
  seekTo?: (seconds: number, allowSeekAhead?: boolean) => void;
  getDuration?: () => number;
}

export function wait(durationMs: number) {
  return new Promise(resolve => setTimeout(resolve, durationMs));
}

function getMoviePlayer() {
  return document.querySelector<MoviePlayer>(MOVIE_PLAYER_SELECTOR);
}

export async function waitForPlayerReady() {
  const deadlineAt = Date.now() + PLAYER_READY_TIMEOUT_MS;
  while (Date.now() < deadlineAt) {
    const player = getMoviePlayer();
    if (player?.playVideo && player.getDuration?.() && player.getDuration() > 0) {
      return player;
    }

    await wait(POLL_INTERVAL_MS);
  }

  return null;
}

// player.playVideo() relies on the youtube.com autoplay heuristic; inside a
// hidden iframe hosted by an extension page Firefox blocks unmuted autoplay
// even with allow="autoplay". Setting <video>.muted=true unconditionally
// satisfies the muted-autoplay path and lets play() resolve, after which the
// player fetches media segments normally (audio bytes are still captured by
// the SourceBuffer hook regardless of <video> mute state).
export async function forcePlayback(player: MoviePlayer) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < PLAYBACK_START_TIMEOUT_MS) {
    const elVideo = document.querySelector<HTMLVideoElement>(VIDEO_ELEMENT_SELECTOR);
    if (elVideo) {
      elVideo.muted = true;
      // Fire-and-forget: in Firefox background tabs, play() may return a
      // Promise that never settles, which would hang the loop if awaited.
      void elVideo.play().catch(() => {});
    }

    player.playVideo?.();
    await wait(POLL_INTERVAL_MS);

    if (elVideo && (!elVideo.paused || elVideo.currentTime > 0 || elVideo.readyState >= 2)) {
      // Unmute now that playback started — YouTube SABR skips audio fetching
      // when the media element is muted; we only muted above to satisfy
      // Firefox's background-tab autoplay policy.
      elVideo.muted = false;
      return true;
    }
  }

  return false;
}

// seekTo alone doesn't kick the SABR fetch in background tabs — force play
// immediately so the player requests media data starting at startSec.
export function postAdSeek(player: MoviePlayer, startSec: number) {
  player.seekTo?.(startSec, true);
  const elVideo = document.querySelector<HTMLVideoElement>(VIDEO_ELEMENT_SELECTOR);
  if (elVideo) {
    elVideo.muted = true;
    player.playVideo?.();
    void elVideo.play().catch(() => {});
    elVideo.muted = false;
  }
}
