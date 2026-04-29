import { wait, POLL_INTERVAL_MS } from "./player";
import { AD_SHOWING_SELECTOR, SKIP_AD_BUTTON_SELECTOR, VIDEO_ELEMENT_SELECTOR } from "@/lib/youtube/player-selectors";

const AD_APPEAR_WAIT_MS = 5_000;
const AD_CLEAR_TIMEOUT_MS = 30_000;

export async function waitForAdToClear() {
  const appearDeadline = Date.now() + AD_APPEAR_WAIT_MS;
  while (Date.now() < appearDeadline) {
    if (document.querySelector(AD_SHOWING_SELECTOR)) {
      break;
    }

    await wait(POLL_INTERVAL_MS);
  }

  if (!document.querySelector(AD_SHOWING_SELECTOR)) {
    return false;
  }

  try {
    const clearDeadline = Date.now() + AD_CLEAR_TIMEOUT_MS;
    while (Date.now() < clearDeadline) {
      if (!document.querySelector(AD_SHOWING_SELECTOR)) {
        return true;
      }

      // Crank rate so non-skippable ads finish in seconds rather than ~2 min,
      // and click skip-ad as soon as it appears.
      const elVideo = document.querySelector<HTMLVideoElement>(VIDEO_ELEMENT_SELECTOR);
      if (elVideo) {
        elVideo.playbackRate = 16;
      }

      document.querySelector<HTMLButtonElement>(SKIP_AD_BUTTON_SELECTOR)?.click();
      await wait(POLL_INTERVAL_MS);
    }

    return true;
  } finally {
    // Reset to 1x once the ad clears - otherwise waitForBufferFill keeps the
    // player at 16x speed and a single iframe blows through ~24 minutes of
    // media in 90s, capturing the entire rest of the video instead of its
    // intended 60s window.
    const elVideo = document.querySelector<HTMLVideoElement>(VIDEO_ELEMENT_SELECTOR);
    if (elVideo) {
      elVideo.playbackRate = 1;
    }
  }
}
