import type { PlayerResponse, YtdlSabrTemplate } from "@/types";

export interface ProgressiveCarryState {
  audioEndMs: number;
  audioLastSeq: number;
  videoEndMs: number;
  videoLastSeq: number;
  audioSegmentBytes: Map<number, Uint8Array>;
  videoSegmentBytes: Map<number, Uint8Array>;
  playbackCookieBytes: Uint8Array | null;
}

export interface ProgressiveFetchResult {
  audioBytes: Uint8Array;
  videoBytes: Uint8Array;
  audioCoveredMs: number;
  videoCoveredMs: number;
  audioItag: number;
  videoItag: number;
  iterations: number;
  isStalled: boolean;
  carryState: ProgressiveCarryState;
}

export interface MoviePlayerElement extends HTMLElement {
  getPlayerResponse?: () => PlayerResponse;
}

export interface YtcfgInnertubeClient {
  clientName?: string;
  clientVersion?: string;
  visitorData?: string;
}

export interface YtcfgRoot {
  data_?: {
    INNERTUBE_CONTEXT?: {
      client?: YtcfgInnertubeClient;
    };
  };
}

export interface FormatProgress {
  itag: number;
  endMs: number;
  lastSeq: number;
  segmentBytes: Map<number, Uint8Array>;
}

export interface ProgressiveState {
  audio: FormatProgress;
  video: FormatProgress;
  playbackCookieBytes: Uint8Array | null;
}

declare global {
  interface Window {
    __ytdlSabrTemplate?: YtdlSabrTemplate;
    __ytdlSabr?: {
      isTemplatePresent: () => boolean;
      fetchProgressive: (options: {
        targetDurationMs: number;
        maxIterations?: number;
        carryState?: ProgressiveCarryState | null;
      }) => Promise<ProgressiveFetchResult>;
      synthesize: () => YtdlSabrTemplate | null;
    };
    ytcfg?: YtcfgRoot;
    ytInitialPlayerResponse?: PlayerResponse;
    __ytdlCapturedPoToken?: string;
    __ytdlSabrInits?: {
      video?: Uint8Array;
      audio?: Uint8Array;
    };
  }
}
