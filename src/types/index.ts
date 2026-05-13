import type { AdaptiveFormatItem, CaptionTrack, PlayerResponse } from "./youtube";

export type {
  AdaptiveFormatItem,
  ButtonViewModelData,
  CaptionTrack,
  PlayerResponse,
  TpYtIronDropdownElement,
  TpYtPaperInputElement,
  TpYtPaperProgressElement,
  YtButtonViewModelElement,
  YtdlCaptureState,
  YtdlMediaCapture
} from "./youtube";

export type { RecentDownloadEntry } from "@/lib/storage/recent-downloads-db";
export type { VideoQueueItem } from "@/lib/storage/storage";
export type { InterruptedDownload, ProgressUpdate } from "@/lib/messaging/messaging";
export type { StreamDataPayload } from "@/lib/messaging/cross-world-messenger";

export {
  ButtonSize,
  ButtonState,
  ButtonStyle,
  ButtonType,
  IconName,
  TooltipPlacement,
  TooltipStyle,
  YtIconName,
  isPolymerInputElement,
  isPolymerProgressElement
} from "./youtube";

export const DownloadType = {
  Auto: "auto",
  VideoAndAudio: "video+audio",
  Video: "video",
  Audio: "audio"
} as const;

export type DownloadType = (typeof DownloadType)[keyof typeof DownloadType];

export const ProgressType = {
  Video: "video",
  Audio: "audio",
  FFmpeg: "ffmpeg",
  Zip: "zip"
} as const;

export type ProgressType = (typeof ProgressType)[keyof typeof ProgressType];

export const VideoQualityMode = {
  Best: "best",
  CurrentQuality: "current-quality",
  Custom: "custom"
} as const;

export type VideoQualityMode = (typeof VideoQualityMode)[keyof typeof VideoQualityMode];

export const PlaylistDownloadMode = {
  Fast: "fast",
  DataSaver: "dataSaver"
} as const;

export type PlaylistDownloadMode = (typeof PlaylistDownloadMode)[keyof typeof PlaylistDownloadMode];

export const PlaylistOutputMode = {
  Individual: "individual",
  Zip: "zip"
} as const;

export type PlaylistOutputMode = (typeof PlaylistOutputMode)[keyof typeof PlaylistOutputMode];

export const AudioTrackLanguageMode = {
  OriginalLanguage: "original",
  MatchVideo: "match-video",
  MatchYouTube: "match-youtube",
  Custom: "custom"
} as const;

export type AudioTrackLanguageMode = (typeof AudioTrackLanguageMode)[keyof typeof AudioTrackLanguageMode];

export const CaptionLanguageMode = {
  SameAsAudio: "same-as-audio",
  OriginalLanguage: "original",
  MatchVideo: "match-video",
  MatchYouTube: "match-youtube",
  Custom: "custom"
} as const;

export type CaptionLanguageMode = (typeof CaptionLanguageMode)[keyof typeof CaptionLanguageMode];

export const ChipStyle = {
  Default: "STYLE_DEFAULT",
  AiCustomizedFeedChip: "STYLE_AI_CUSTOMIZED_FEED_CHIP",
  ExploreLauncherChip: "STYLE_EXPLORE_LAUNCHER_CHIP"
} as const;

// https://github.com/LuanRT/YouTube.js/blob/main/src/parser/classes/ChipCloudChip.ts
export type ChipData = {
  text: {
    simpleText: string;
  };
  style: {
    styleType: (typeof ChipStyle)[keyof typeof ChipStyle];
  };
  isSelected: boolean;
  navigationEndpoint?: {
    clickTrackingParams?: string;
    browseEndpoint?: {
      browseId: string;
      params?: string;
    };
  };
  trackingParams?: string;
  accessibilityData?: {
    accessibilityData: {
      label: string;
    };
  };
};

export const TrackKind = {
  Audio: "audio",
  Captions: "captions"
} as const;

export type TrackKind = (typeof TrackKind)[keyof typeof TrackKind];

export const PanelTrackMode = {
  MatchVideo: "follow",
  Original: "original",
  Custom: "custom"
} as const;

export type PanelTrackMode = (typeof PanelTrackMode)[keyof typeof PanelTrackMode];

export const StreamType = {
  Video: "video",
  Audio: "audio"
} as const;

export const AUDIO_EXTRA_STREAM_PREFIX = "audio-extra";

export type StreamType = (typeof StreamType)[keyof typeof StreamType];

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

export type DownloadRequest = {
  type: DownloadType;
  videoId: string;
  videoItag: number;
  audioItag: number;
  audioTrackId?: string;
  selectedCaptionVssId?: string;
  filenameOutput: string;
  sabrConfig?: SabrConfig | null;
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
};

export type StreamData = {
  type: DownloadType;
  videoId: string;
  filenameOutput: string;
  videoData: Uint8Array | null;
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
};
