// Re-export YouTube API/runtime types
import type { AdaptiveFormatItem, PlayerResponse } from "./youtube";

export type {
  AdaptiveFormatItem,
  ButtonViewModelData,
  PlayerResponse,
  TpYtIronDropdownElement,
  TpYtPaperProgressElement,
  YtButtonViewModelElement,
  YtdlCaptureState,
  YtdlMediaCapture
} from "./youtube";

export {
  ButtonSize,
  ButtonState,
  ButtonStyle,
  ButtonType,
  IconName,
  isPolymerProgressElement
} from "./youtube";

// -- Extension state types ----------------------------------------------------

export enum DownloadType {
  VideoAndAudio = "video+audio",
  Video = "video",
  Audio = "audio"
}

export enum ProgressType {
  Video = "video",
  Audio = "audio",
  FFmpeg = "ffmpeg"
}

export enum VideoQualityMode {
  Best = "best",
  CurrentQuality = "current-quality",
  Custom = "custom"
}

export enum PlaylistDownloadMode {
  Fast = "fast",
  DataSaver = "dataSaver"
}

export enum PlaylistOutputMode {
  Individual = "individual",
  Zip = "zip"
}

export enum StreamType {
  Video = "video",
  Audio = "audio"
}

export type ProgressUpdate = {
  videoId: string;
  progress: number;
  progressType: ProgressType;
  isRemoved?: boolean;
};

export type SabrConfig = {
  serverAbrStreamingUrl: string;
  videoPlaybackUstreamerConfig: string;
  clientName: number;
  clientVersion: string;
  formats: AdaptiveFormatItem[];
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
  sabrUrl?: string;
  videoFormat?: AdaptiveFormatItem | null;
  audioFormat?: AdaptiveFormatItem | null;
  additionalAudioFormats?: AdaptiveFormatItem[];
  primaryAudioLabel?: string;
  metadata?: VideoMetadata | null;
  resolvedVideoUrl?: string | null;
  resolvedAudioUrl?: string | null;
  resolvedExtraAudioUrls?: (string | null)[];
};

export type InterruptedDownload = {
  videoId: string;
  type: DownloadType;
  filenameOutput: string;
  videoItag: number;
  audioItag: number;
  timestamp: number;
};

export type VideoQueueItem = {
  videoId: string;
  filenameOutput: string;
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
  isRemoveNativeDownload: boolean;
};

export type AudioStreamData = {
  data: Uint8Array | null;
  mimeType: string;
  label: string;
};

export type StreamData = {
  type: DownloadType;
  videoId: string;
  filenameOutput: string;
  videoData: Uint8Array | null;
  audioData: Uint8Array | null;
  videoMimeType: string;
  audioMimeType: string;
  // Label for the primary audio track (shown in VLC track selector)
  primaryAudioLabel?: string;
  // Additional language tracks to embed alongside the primary
  additionalAudioStreams: AudioStreamData[];
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

export type StreamDataPayload = {
  downloadType: DownloadType;
  videoId: string;
  filenameOutput: string;
  videoData: Uint8Array | null;
  audioData: Uint8Array | null;
  videoMimeType: string;
  audioMimeType: string;
  audioLabel: string;
  additionalAudioData: AudioStreamData[];
  metadata?: VideoMetadata | null;
};

export type StreamError = {
  videoId: string;
  error: string;
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
};
