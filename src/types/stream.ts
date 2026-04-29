import type { ScrubSegment, SubtitleStream, VideoMetadata } from "./common";
import type { DownloadType } from "./download";

export const StreamType = {
  Video: "video",
  Audio: "audio"
} as const;

export type StreamType = (typeof StreamType)[keyof typeof StreamType];

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
  segments?: ScrubSegment[];
  segmentDurationSec?: number;
  totalDurationSec?: number;
};

export type ProcessStreamData = StreamData & {
  tabId: number;
  playlistId?: string;
  playlistTitle?: string;
  playlistTotalCount?: number;
  metadata?: VideoMetadata | null;
};

export type { VideoMetadata, ScrubSegment, SubtitleStream };
