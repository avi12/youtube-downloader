// Centralized YouTube player DOM selectors. The same handful of strings are
// referenced from sabr-fetch-interceptor (ad detection on POST capture) and
// scrub-self-drive (ad-clear loop, force-play, capture binding).

export const MOVIE_PLAYER_SELECTOR = "#movie_player";
export const VIDEO_ELEMENT_SELECTOR = "video";
export const AD_SHOWING_SELECTOR = ".html5-video-player.ad-showing";
export const SKIP_AD_BUTTON_SELECTOR =
  ".ytp-skip-ad-button, .ytp-ad-skip-button-modern, .ytp-ad-skip-button";
