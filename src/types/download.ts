import type { SubtitleStream, VideoMetadata } from "./common";
import type { AdaptiveFormatItem } from "./youtube-formats";
import type { CaptionTrack } from "./youtube-player";

export type SabrConfig = {
  serverAbrStreamingUrl: string;
  videoPlaybackUstreamerConfig: string;
  clientName: number;
  clientVersion: string;
  formats: AdaptiveFormatItem[];
};

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
  primerBodyBase64?: string;
  authorization?: string;
};

export type DownloadTypePreference = "auto" | DownloadType;

export type { SubtitleStream };
