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
  getPlayerResponse?: () => unknown;
  setPlaybackQuality?: (quality: string) => void;
  setPlaybackQualityRange?: (suggestedQuality: string, maximumQuality: string) => void;
}

export async function wait(durationMs: number) {
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

export async function waitForPlayerElement() {
  const deadlineAt = Date.now() + PLAYER_READY_TIMEOUT_MS;
  while (Date.now() < deadlineAt) {
    const player = getMoviePlayer();
    if (player?.getPlayerResponse) {
      return player;
    }

    await wait(POLL_INTERVAL_MS);
  }

  return null;
}

// Firefox blocks unmuted autoplay in hidden iframes even with allow="autoplay".
// Keeping the video muted satisfies the muted-autoplay path so play() resolves.
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
      return true;
    }
  }

  return false;
}

// Seek and kick playback at the new position. Mutes for the play() call to
// satisfy autoplay policy, then unmutes so the player requests audio SABR
// tracks. Audio output is silenced via the AudioContext set up in
// setupIframeVideoSilencing(), so no sound reaches the speakers.
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
