// YouTube exposes its main player as a DOM element with `id="movie_player"`
// that has the IFrame Player API methods grafted onto it. All methods are
// optional because they may be unavailable on a partially-loaded player.

export interface MoviePlayerElement extends HTMLElement {
  // Playback control
  playVideo?: () => void;
  pauseVideo?: () => void;
  stopVideo?: () => void;
  seekTo?: (seconds: number, allowSeekAhead?: boolean) => void;
  setPlaybackRate?: (rate: number) => void;
  // State queries
  getPlayerState?: () => number;
  getCurrentTime?: () => number;
  getDuration?: () => number;
  getVideoLoadedFraction?: () => number;
  getPlaybackQuality?: () => string;
  getAvailableQualityLevels?: () => string[];
  // Video metadata
  getVideoData?: () => {
    video_id: string;
    title: string;
    author: string;
    isLive?: boolean;
  };
  getVideoUrl?: () => string;
  getVideoEmbedCode?: () => string;
  // Volume
  mute?: () => void;
  unMute?: () => void;
  isMuted?: () => boolean;
  setVolume?: (volume: number) => void;
  getVolume?: () => number;
  // Loading new content
  loadVideoById?: (videoId: string, startSeconds?: number) => void;
  cueVideoById?: (videoId: string, startSeconds?: number) => void;
  // Playlists
  nextVideo?: () => void;
  previousVideo?: () => void;
  playVideoAt?: (index: number) => void;
  getPlaylist?: () => string[];
  getPlaylistIndex?: () => number;
  // Sizing + lifecycle
  setSize?: (width: number, height: number) => void;
  destroy?: () => void;
  // Event subscription
  addEventListener: HTMLElement["addEventListener"] & {
    (event: string, listener: (...args: unknown[]) => void): void;
  };
  removeEventListener: HTMLElement["removeEventListener"] & {
    (event: string, listener: (...args: unknown[]) => void): void;
  };
}

export function getMoviePlayer() {
  return document.querySelector<MoviePlayerElement>("#movie_player");
}
