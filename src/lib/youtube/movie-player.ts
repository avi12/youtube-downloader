/**
 * YouTube exposes its main player as a DOM element with `id="movie_player"`
 * that has the IFrame Player API methods grafted onto it. Methods are optional
 * because they're absent on a partially-loaded player.
 *
 * @see https://developers.google.com/youtube/iframe_api_reference
 */
export interface MoviePlayerElement extends HTMLElement {
  /** Plays the currently cued/loaded video. */
  playVideo?: () => void;
  /** Pauses the currently playing video. */
  pauseVideo?: () => void;
  /** Stops and cancels loading of the current video. */
  stopVideo?: () => void;
  /**
   * Seeks to a specified time in the video.
   * @param allowSeekAhead Whether the request may trigger a new server request when seeking past buffered data.
   */
  seekTo?: (seconds: number, allowSeekAhead?: boolean) => void;
  /** Sets the suggested playback rate. */
  setPlaybackRate?: (rate: number) => void;

  /**
   * Returns the player state.
   * -1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering, 5 video cued.
   */
  getPlayerState?: () => number;
  /** Returns the elapsed time in seconds since the video started playing. */
  getCurrentTime?: () => number;
  /** Returns the duration in seconds of the currently playing video. */
  getDuration?: () => number;
  /** Returns a number between 0 and 1 indicating how much of the video has buffered. */
  getVideoLoadedFraction?: () => number;
  /** Returns the current playback quality (e.g. `"hd1080"`, `"large"`, `"medium"`). */
  getPlaybackQuality?: () => string;
  /** Returns the quality formats currently available for the video. */
  getAvailableQualityLevels?: () => string[];

  /** Returns YouTube-internal metadata about the currently loaded video. */
  getVideoData?: () => {
    video_id: string;
    title: string;
    author: string;
    isLive?: boolean;
  };
  /** Returns the YouTube.com URL for the currently loaded/playing video. */
  getVideoUrl?: () => string;
  /** Returns the embed code for the currently loaded/playing video. */
  getVideoEmbedCode?: () => string;

  /** Mutes the player. */
  mute?: () => void;
  /** Unmutes the player. */
  unMute?: () => void;
  /** Returns whether the player is currently muted. */
  isMuted?: () => boolean;
  /** Sets the volume on a 0-100 scale. */
  setVolume?: (volume: number) => void;
  /** Returns the current volume on a 0-100 scale. */
  getVolume?: () => number;

  /** Loads and plays the specified video. */
  loadVideoById?: (videoId: string, startSeconds?: number) => void;
  /** Loads and cues (does not play) the specified video. */
  cueVideoById?: (videoId: string, startSeconds?: number) => void;

  /** Loads and plays the next video in the playlist. */
  nextVideo?: () => void;
  /** Loads and plays the previous video in the playlist. */
  previousVideo?: () => void;
  /** Loads and plays the playlist video at the given zero-based index. */
  playVideoAt?: (index: number) => void;
  /** Returns an array of the video IDs in the current playlist. */
  getPlaylist?: () => string[];
  /** Returns the index of the currently playing playlist video. */
  getPlaylistIndex?: () => number;

  /** Sets the player size in pixels. */
  setSize?: (width: number, height: number) => void;
  /** Removes the iframe element used by the player and frees resources. */
  destroy?: () => void;

  /** Internal flag set by ytdl to prevent double-subscribing to internalaudioformatchange on the player bus. */
  __ytdlAudioWatched?: boolean;
  /** Internal flag set by ytdl to prevent double-subscribing to captionschanged on the player bus. */
  __ytdlCaptionWatched?: boolean;

  /**
   * Gets a player module option value.
   * @see https://developers.google.com/youtube/iframe_api_reference
   */
  getOption?: (module: string, option: string) => unknown;
  /**
   * Sets a player module option value. Used internally by YouTube for captions,
   * playback speed, and other module-scoped settings.
   * @see https://developers.google.com/youtube/iframe_api_reference
   */
  setOption?: (module: string, option: string, value: unknown) => void;

  getAudioTrack?: () => {
    gw?: {
      id?: string;
      name?: string;
    };
  } | null;
  getAvailableAudioTracks?: () => Array<{
    gw?: {
      id?: string;
      name?: string;
    };
  }>;
  setAudioTrack?: (track: {
    gw?: {
      id?: string;
      name?: string;
    };
  }) => void;
}

export function getMoviePlayer() {
  return document.querySelector<MoviePlayerElement>("#movie_player");
}

export type PlayerCaptionTrackData = {
  languageCode: string;
  displayName: string;
  vss_id: string;
};

export function isPlayerCaptionTrackData(value: unknown): value is PlayerCaptionTrackData {
  return (
    typeof value === "object"
    && value !== null
    && "languageCode" in value
    && "vss_id" in value
  );
}

export const ACTIVE_CAPTION_ATTR = "data-ytdl-caption";

export type CaptionEventBus = {
  subscribe: (topic: string, handler: (data: unknown) => void) => void;
};

type CaptionBusContext = {
  state?: {
    L?: CaptionEventBus;
  };
};

function isGetOptionFn(value: unknown): value is (module: string, option: string) => unknown {
  return typeof value === "function";
}

function isCaptionBusContext(value: unknown): value is CaptionBusContext {
  return typeof value === "object" && value !== null;
}

// YouTube's internal caption module uses a closure `(...V) => h.apply(R, V)` for getOption.
// Intercepting Function.prototype.apply while calling it lets us capture R, whose state.L
// is the pub/sub bus that emits "captionschanged" on every track switch.
export function capturePlayerCaptionBus(player: MoviePlayerElement): CaptionEventBus | null {
  let proto: MoviePlayerElement | null = player;
  let rawGetOption: ((module: string, option: string) => unknown) | null = null;

  while (proto) {
    const desc = Object.getOwnPropertyDescriptor(proto, "getOption");
    if (isGetOptionFn(desc?.value)) {
      rawGetOption = desc.value;
      break;
    }

    proto = Object.getPrototypeOf(proto);
  }

  if (!rawGetOption) {
    return null;
  }

  const origApply = Function.prototype.apply;
  let internalCtx: unknown = null;

  type AnyFn = (...args: unknown[]) => unknown;

  function captureApply(this: AnyFn, thisArg: unknown, args: unknown[]) {
    if (!internalCtx && Array.isArray(args) && args[0] === "captions") {
      internalCtx = thisArg;
    }

    return origApply.call(this, thisArg, args);
  }

  try {
    Object.defineProperty(Function.prototype, "apply", {
      value: captureApply,
      configurable: true
    });
    rawGetOption.call(player, "captions", "track");
  } finally {
    Object.defineProperty(Function.prototype, "apply", {
      value: origApply,
      configurable: true
    });
  }

  if (!isCaptionBusContext(internalCtx)) {
    return null;
  }

  return internalCtx.state?.L ?? null;
}
