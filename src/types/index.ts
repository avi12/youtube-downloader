import type { AdaptiveFormatItem, CaptionTrack, PlayerResponse } from "./youtube";

export type {
  AdaptiveFormatItem,
  ButtonViewModelData,
  CaptionTrack,
  PlayerResponse,
  TpYtIronDropdownElement,
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
  isPolymerProgressElement
} from "./youtube";

export const DownloadType = {
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

export const StreamType = {
  Video: "video",
  Audio: "audio"
} as const;

export type StreamType = (typeof StreamType)[keyof typeof StreamType];

export type SabrConfig = {
  serverAbrStreamingUrl: string;
  videoPlaybackUstreamerConfig: string;
  clientName: number;
  clientVersion: string;
  formats: AdaptiveFormatItem[];
};

export type SubtitleStream = {
  srtContent: string;
  languageCode: string;
  label: string;
};

export type DownloadRequest = {
  type: DownloadType;
  videoId: string;
  videoItag: number;
  audioItag: number;
  filenameOutput: string;
  sabrConfig?: SabrConfig | null;
  isIframeFallback?: boolean;
  playlistId?: string;
  playlistTitle?: string;
  playlistTotalCount?: number;
  poToken?: string;
  alternateClientPoToken?: string;
  sabrUrl?: string;
  videoFormat?: AdaptiveFormatItem | null;
  audioFormat?: AdaptiveFormatItem | null;
  additionalAudioFormats?: AdaptiveFormatItem[];
  primaryAudioLabel?: string;
  metadata?: VideoMetadata | null;
  resolvedVideoUrl?: string | null;
  resolvedAudioUrl?: string | null;
  resolvedExtraAudioUrls?: (string | null)[];
  captionTracks?: CaptionTrack[];
  debugRangedFromSec?: number;
};

export type DownloadTypePreference = "auto" | DownloadType;

export type Options = {
  ext: {
    audio: string;
    video: string;
  };
  defaultDownloadType: DownloadTypePreference;
  videoQualityMode: VideoQualityMode;
  videoQuality: number;
  isShowNativeDownload: boolean;
  playlistDownloadMode: PlaylistDownloadMode;
  playlistOutputMode: PlaylistOutputMode;
  playlistAudioOutputMode: PlaylistOutputMode;
  isPlaylistScrollSyncEnabled: boolean;
};

export type ScrubSegment = {
  video: Uint8Array;
  audio: Uint8Array;
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
  additionalAudioStreams: {
    data: Uint8Array | null;
    mimeType: string;
    label: string;
  }[];
  subtitleStreams: SubtitleStream[];
  // When present, assembled from iframe-scrub captures — each segment is a
  // self-contained fMP4/WebM. The pipeline uses FFmpeg's concat demuxer with
  // an MKV intermediate to handle timestamp discontinuities at segment seams,
  // then transcodes back to the target container via stream-copy.
  segments?: ScrubSegment[];
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
  sabrConfig: SabrConfig | null;
  captionTracks: CaptionTrack[];
};

// MAIN-world cache of the player's most recent SABR POST: URL plus the raw
// protobuf body so we can replay it against googlevideo without rebuilding
// PoToken/session signals from scratch.
export type YtdlSabrTemplate = {
  url: string;
  body: Uint8Array;
  capturedAt: number;
};
