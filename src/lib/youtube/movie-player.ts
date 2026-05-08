// YouTube exposes its main player as a DOM element with `id="movie_player"`
// that has the IFrame Player API methods grafted onto it. Methods are optional
// because they're absent on a partially-loaded player.

export interface MoviePlayerElement extends HTMLElement {
  pauseVideo?: () => void;
  stopVideo?: () => void;
}

export function getMoviePlayer() {
  return document.querySelector<MoviePlayerElement>("#movie_player");
}
