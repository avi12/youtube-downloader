import type {
  AudioTrackLanguageMode,
  CaptionLanguageMode,
  DownloadType,
  PlaylistDownloadMode,
  PlaylistOutputMode,
  VideoQualityMode
} from "./download-enums";
import type { AdaptiveFormatItem } from "./youtube";

export type VideoTabParams = {
  videoId: string;
  tabId: number;
};

export type SabrConfig = {
  serverAbrStreamingUrl: string;
  videoPlaybackUstreamerConfig: string;
  clientName: number;
  clientVersion: string;
  formats: AdaptiveFormatItem[];
};

export type SubtitleTrack = {
  data: Uint8Array | null;
  label: string;
  languageCode: string;
};

export type VideoMetadata = {
  title: string;
  artist: string;
  albumArtist?: string;
  album?: string;
  genres?: string[];
  date?: string;
  thumbnailUrl?: string;
  isMusic: boolean;
};

export type DownloadTypePreference = DownloadType;

export type Options = {
  ext: {
    audio: string;
    video: string;
  };
  defaultDownloadType: DownloadTypePreference;
  videoQualityMode: VideoQualityMode;
  videoQuality: number;
  enhancedBitrate: boolean;
  isShowNativeDownload: boolean;
  isNotifyOnIdle: boolean;
  isRevealOnComplete: boolean;
  playlistDownloadMode: PlaylistDownloadMode;
  playlistOutputMode: PlaylistOutputMode;
  playlistAudioOutputMode: PlaylistOutputMode;
  isPlaylistScrollSyncEnabled: boolean;
  audioTrackLanguageMode: AudioTrackLanguageMode;
  captionLanguageMode: CaptionLanguageMode;
  customLanguage: string;
  downloadExtras: boolean;
  includeAutoDubbing: boolean;
  includeAiCaptions: boolean;
};
