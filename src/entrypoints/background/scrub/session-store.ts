import type { AdaptiveFormatItem, CaptionTrack, DownloadType, VideoMetadata } from "@/types";

export interface ReceivedSegment {
  videoBytes: Uint8Array;
  audioBytes: Uint8Array;
  videoMimeType: string;
  audioMimeType: string;
  videoBufferStartSec?: number;
  videoBufferEndSec?: number;
}

export interface SegmentArrival extends ReceivedSegment {
  videoId: string;
  iScrub: number;
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
  videoFormat?: AdaptiveFormatItem | null;
  audioFormat?: AdaptiveFormatItem | null;
  prefetchedVideoInit?: Uint8Array;
  prefetchedAudioInit?: Uint8Array;
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
  videoFormat?: AdaptiveFormatItem | null;
  audioFormat?: AdaptiveFormatItem | null;
}

export const sessionsByVideoId = new Map<string, ScrubSession>();
export const iframeIdByVideoIdAndIndex = new Map<string, string>();
export const deadlineTimersByIframeId = new Map<string, ReturnType<typeof setTimeout>>();
export const globalInFlightIframeIds = new Set<string>();

export function makeIframeKey(videoId: string, iScrub: number) {
  return `${videoId}:${iScrub}`;
}

export function makeIframeId(videoId: string, iScrub: number, attempt: number) {
  return `${videoId}:${iScrub}:${attempt}`;
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
    durationSec: data.durationSec,
    videoFormat: data.videoFormat,
    audioFormat: data.audioFormat,
    prefetchedVideoInit: undefined,
    prefetchedAudioInit: undefined
  };
}

export function recordEmptyAfterRetries({ session, iScrub, logFn }: {
  session: ScrubSession;
  iScrub: number;
  logFn: (msg: string) => void;
}) {
  logFn(`index ${iScrub} exhausted retries, accepting empty`);
  session.receivedSegments.set(
    iScrub, {
      videoBytes: new Uint8Array(0),
      audioBytes: new Uint8Array(0),
      videoMimeType: "",
      audioMimeType: ""
    } satisfies ReceivedSegment
  );
}
