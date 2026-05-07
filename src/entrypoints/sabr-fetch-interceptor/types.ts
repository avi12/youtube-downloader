import type { AdaptiveFormatItem, PlayerResponse, YtdlCaptureState, YtdlSabrTemplate } from "@/types";

export interface SabrContextEntry {
  type: number;
  value: Uint8Array;
  sendByDefault: boolean;
}

export interface ProgressiveCarryState {
  audioEndMs: number;
  audioLastSeq: number;
  audioLastSegDurationMs: number;
  videoEndMs: number;
  videoLastSeq: number;
  videoLastSegDurationMs: number;
  audioSegmentBytes: Map<number, Uint8Array>;
  videoSegmentBytes: Map<number, Uint8Array>;
  playbackCookieBytes: Uint8Array | null;
  sabrContexts: Map<number, SabrContextEntry>;
  activeSabrContextTypes: Set<number>;
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
  needsTemplateRefresh: boolean;
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
  lastSegDurationMs: number;
  segmentBytes: Map<number, Uint8Array>;
}

export interface ProgressiveState {
  audio: FormatProgress;
  video: FormatProgress;
  playbackCookieBytes: Uint8Array | null;
  sabrContexts: Map<number, SabrContextEntry>;
  activeSabrContextTypes: Set<number>;
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
        urlOverride?: string;
        audioFormat?: AdaptiveFormatItem | null;
        videoFormat?: AdaptiveFormatItem | null;
        authorization?: string;
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
    __ytdlDebugLog?: string[];
    __ytdlCapture?: YtdlCaptureState;
  }
}
