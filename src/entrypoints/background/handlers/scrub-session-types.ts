import type { AdaptiveFormatItem, CaptionTrack, DownloadType, VideoMetadata } from "@/types";

export interface ReceivedSegment {
  videoBase64: string;
  audioBase64: string;
  videoMimeType: string;
  audioMimeType: string;
  videoBufferStartSec?: number;
}

export interface SegmentArrival extends ReceivedSegment {
  videoId: string;
  scrubIndex: number;
}

export interface ScrubSession {
  videoId: string;
  expectedCount: number;
  stepSec: number;
  receivedSegments: Map<number, ReceivedSegment>;
  pendingIndices: number[];
  attemptsByIndex: Map<number, number>;
  inFlightIframeIds: Set<string>;
  tabId: number;
  filenameOutput: string;
  type: DownloadType;
  videoMimeType: string;
  audioMimeType: string;
  audioLabel: string;
  metadata?: VideoMetadata | null;
  playlistId?: string;
  playlistTitle?: string;
  playlistTotalCount?: number;
  resolvedVideoMimeType: string;
  resolvedAudioMimeType: string;
  additionalAudioFormats: AdaptiveFormatItem[];
  resolvedExtraAudioUrls: (string | null)[];
  captionTracks: CaptionTrack[];
  durationSec: number;
}

export interface StartIframeScrubArgs {
  videoId: string;
  durationSec: number;
  stepSec?: number;
  type: DownloadType;
  filenameOutput: string;
  videoMimeType: string;
  audioMimeType: string;
  audioLabel: string;
  metadata?: VideoMetadata | null;
  playlistId?: string;
  playlistTitle?: string;
  playlistTotalCount?: number;
  tabId: number;
  additionalAudioFormats?: AdaptiveFormatItem[];
  resolvedExtraAudioUrls?: (string | null)[];
  captionTracks?: CaptionTrack[];
}
