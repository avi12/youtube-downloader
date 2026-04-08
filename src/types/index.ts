// Re-export YouTube API/runtime types
import type { AdaptiveFormatItem, PlayerResponse } from "./youtube";

export type {
  AdaptiveFormatItem,
  ButtonViewModelData,
  PlayerResponse,
  TpYtIronDropdownElement,
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

export type DownloadType = "video+audio" | "video" | "audio";

export enum ProgressType {
  Video = "video",
  Audio = "audio",
  FFmpeg = "ffmpeg"
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
  playlistId?: string;
  playlistTitle?: string;
  playlistTotalCount?: number;
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
  videoQualityMode: "best" | "current-quality" | "custom";
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
  additionalAudioStreams?: AudioStreamData[];
};

export type VideoMetadata = {
  title: string;
  artist: string;
  date?: string;
  thumbnailUrl?: string;
  isMusic: boolean;
};

export type ProcessStreamData = StreamData & {
  tabId: number;
  playlistId?: string;
  playlistTitle?: string;
  playlistTotalCount?: number;
  metadata?: VideoMetadata;
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
  metadata?: VideoMetadata;
};

export type StreamError = {
  videoId: string;
  error: string;
};

// -- UI types -----------------------------------------------------------------

export type MovableItem = { id: string;
  title: string; };

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
