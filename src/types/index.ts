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
  YtdlMediaCapture,
  YtdlSabrTemplate
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
  videoDurationSec?: number;
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
  // Actual video buffer start (seconds in original timeline). The VP9 player
  // snaps to the nearest keyframe before the seek target, so this is typically
  // a few seconds earlier than the intended segment start. Used by the pipeline
  // to compute input-side -ss (skip preroll) before the per-segment mux so
  // video and audio both begin at the same original timeline position.
  videoBufferStartSec?: number;
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
  // Per-segment trim duration in seconds. The iframe captures the requested
  // window plus the player's buffer-ahead (~50s past currentTime), so each
  // raw segment carries ~110s of media even though it represents 60s of the
  // source. The pipeline trims to this duration during pre-mux.
  segmentDurationSec?: number;
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
