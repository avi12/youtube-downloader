export interface MoviePlayerElement extends HTMLElement {
  playVideo?: () => void;
  pauseVideo?: () => void;
  stopVideo?: () => void;
  seekTo?: (seconds: number, allowSeekAhead?: boolean) => void;
  setPlaybackRate?: (rate: number) => void;

  getPlayerState?: () => number;
  getCurrentTime?: () => number;
  getDuration?: () => number;
  getVideoLoadedFraction?: () => number;
  getPlaybackQuality?: () => string;
  getAvailableQualityLevels?: () => string[];

  getVideoData?: () => {
    video_id: string;
    title: string;
    author: string;
    isLive?: boolean;
  };
  getVideoUrl?: () => string;
  getVideoEmbedCode?: () => string;

  mute?: () => void;
  unMute?: () => void;
  isMuted?: () => boolean;
  setVolume?: (volume: number) => void;
  getVolume?: () => number;

  loadVideoById?: (videoId: string, startSeconds?: number) => void;
  cueVideoById?: (videoId: string, startSeconds?: number) => void;

  nextVideo?: () => void;
  previousVideo?: () => void;
  playVideoAt?: (index: number) => void;
  getPlaylist?: () => string[];
  getPlaylistIndex?: () => number;

  setSize?: (width: number, height: number) => void;
  destroy?: () => void;

  /** Internal flag set by ytdl to prevent double-subscribing to internalaudioformatchange on the player bus. */
  __ytdlAudioWatched?: boolean;
  /** Internal flag set by ytdl to prevent double-subscribing to captionschanged on the player bus. */
  __ytdlCaptionWatched?: boolean;

  getOption?: (module: string, option: string) => unknown;
  setOption?: (module: string, option: string, value: unknown) => void;
  isSubtitlesOn?: () => boolean;
  toggleSubtitlesOn?: (on?: boolean) => void;
  loadModule?: (module: string) => void;

  getAudioTrack?: () => Record<string, unknown> | null;
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

export type PlayerCaptionTrackData = {
  languageCode: string;
  displayName: string;
  vss_id: string;
};

export type CaptionEventBus = {
  subscribe: (topic: string, handler: (data: unknown) => void) => void;
};

export const ACTIVE_CAPTION_ATTR = "data-ytdl-caption";
export const ACTIVE_AUDIO_ATTR = "data-ytdl-audio";
