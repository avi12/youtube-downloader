import type {
  AudioTrackLanguageMode,
  CaptionLanguageMode,
  DownloadType,
  PlaylistDownloadMode,
  PlaylistOutputMode,
  VideoQualityMode
} from "./download-enums";
import type { Prettify } from "./prettify";
import type { AdaptiveFormatItem } from "./youtube";

export type VideoTabParams = Prettify<{
  videoId: string;
  tabId: number;
}>;

export type SabrConfig = Prettify<{
  serverAbrStreamingUrl: string;
  videoPlaybackUstreamerConfig: string;
  clientName: number;
  clientVersion: string;
  formats: AdaptiveFormatItem[];
}>;

export type SubtitleTrack = Prettify<{
  data: Uint8Array | null;
  label: string;
  languageCode: string;
}>;

export type VideoMetadata = Prettify<{
  title: string;
  artist: string;
  albumArtist?: string;
  album?: string;
  genres?: string[];
  date?: string;
  thumbnailUrl?: string;
  isMusic: boolean;
}>;

export type DownloadTypePreference = DownloadType;

export type Options = Prettify<{
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
}>;
