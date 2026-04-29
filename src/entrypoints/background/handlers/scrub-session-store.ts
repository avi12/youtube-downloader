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

export const sessionsByVideoId = new Map<string, ScrubSession>();
export const iframeIdByVideoIdAndIndex = new Map<string, string>();
export const deadlineTimersByIframeId = new Map<string, ReturnType<typeof setTimeout>>();
export const globalInFlightIframeIds = new Set<string>();

export function makeIframeKey(videoId: string, scrubIndex: number) {
  return `${videoId}:${scrubIndex}`;
}

export function makeIframeId(videoId: string, scrubIndex: number, attempt: number) {
  return `${videoId}:${scrubIndex}:${attempt}`;
}

export function buildSession(data: StartIframeScrubArgs, stepSec: number, expectedCount: number): ScrubSession {
  return {
    videoId: data.videoId,
    expectedCount,
    stepSec,
    receivedSegments: new Map(),
    pendingIndices: Array.from({ length: expectedCount }, (_, i) => i),
    attemptsByIndex: new Map(),
    inFlightIframeIds: new Set(),
    tabId: data.tabId,
    filenameOutput: data.filenameOutput,
    type: data.type,
    videoMimeType: data.videoMimeType,
    audioMimeType: data.audioMimeType,
    audioLabel: data.audioLabel,
    metadata: data.metadata,
    playlistId: data.playlistId,
    playlistTitle: data.playlistTitle,
    playlistTotalCount: data.playlistTotalCount,
    resolvedVideoMimeType: "",
    resolvedAudioMimeType: "",
    additionalAudioFormats: data.additionalAudioFormats ?? [],
    resolvedExtraAudioUrls: data.resolvedExtraAudioUrls ?? [],
    captionTracks: data.captionTracks ?? [],
    durationSec: data.durationSec
  };
}

export function recordEmptyAfterRetries({ session, scrubIndex, logFn }: {
  session: ScrubSession;
  scrubIndex: number;
  logFn: (msg: string) => void;
}) {
  logFn(`index ${scrubIndex} exhausted retries, accepting empty`);
  session.receivedSegments.set(
    scrubIndex, {
      videoBase64: "",
      audioBase64: "",
      videoMimeType: "",
      audioMimeType: ""
    } satisfies ReceivedSegment
  );
}

export function rememberResolvedMimes({ session, segment }: {
  session: ScrubSession;
  segment: ReceivedSegment;
}) {
  if (!session.resolvedVideoMimeType && segment.videoMimeType) {
    session.resolvedVideoMimeType = segment.videoMimeType;
  }

  if (!session.resolvedAudioMimeType && segment.audioMimeType) {
    session.resolvedAudioMimeType = segment.audioMimeType;
  }
}
