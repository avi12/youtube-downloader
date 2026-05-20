import type { DownloadType } from "./download-enums";
import type { SabrConfig, SubtitleTrack, VideoMetadata } from "./settings-types";
import type { AdaptiveFormatItem, CaptionTrack, PlayerResponse } from "./youtube";

export type DownloadRequest = {
  type: DownloadType;
  videoId: string;
  videoItag: number;
  audioItag: number;
  audioTrackId?: string;
  selectedCaptionVssId?: string;
  filenameOutput: string;
  sabrConfig?: SabrConfig | null;
  downloadExtras?: boolean;
  includeAutoDubbing?: boolean;
  isIframeFallback?: boolean;
  playlistId?: string;
  playlistTitle?: string;
  playlistTotalCount?: number;
  poToken?: string;
  sabrUrl?: string;
  videoFormat?: AdaptiveFormatItem | null;
  audioFormat?: AdaptiveFormatItem | null;
  additionalAudioFormats?: AdaptiveFormatItem[];
  primaryAudioLabel?: string;
  primaryAudioLanguageCode?: string;
  captionTracks?: CaptionTrack[];
  captionVttData?: (string | null)[];
  metadata?: VideoMetadata | null;
  resolvedVideoUrl?: string | null;
  resolvedAudioUrl?: string | null;
  resolvedExtraAudioUrls?: (string | null)[];
  progressiveUrl?: string | null;
};

export type StreamData = {
  type: DownloadType;
  videoId: string;
  filenameOutput: string;
  videoData: Uint8Array | null;
  videoFile?: File;
  audioData: Uint8Array | null;
  videoMimeType: string;
  audioMimeType: string;
  primaryAudioLabel?: string;
  primaryAudioLanguageCode?: string;
  additionalAudioStreams: {
    data: Uint8Array | null;
    mimeType: string;
    label: string;
    languageCode?: string;
  }[];
  subtitleTracks: SubtitleTrack[];
};

export type ProcessStreamData = StreamData & {
  tabId: number;
  playlistId?: string;
  playlistTitle?: string;
  playlistTotalCount?: number;
  defaultAudioTrackIndex?: number;
  metadata?: VideoMetadata | null;
};

export type VideoData = {
  playerResponse: PlayerResponse;
  videoId: string;
  title: string;
  isMusic: boolean;
  isDownloadable: boolean;
  isLive: boolean;
  videoFormats: AdaptiveFormatItem[];
  audioFormats: AdaptiveFormatItem[];
  captionTracks: CaptionTrack[];
  sabrConfig: SabrConfig | null;
  progressiveUrl: string | null;
};
