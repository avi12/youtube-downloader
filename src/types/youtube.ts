import type { ButtonViewModelData } from "@/lib/ui/polymer-utils";

export type { ButtonViewModelData };

export type MediaItem = {
  itag: number;
  url?: string;
  mimeType: `${"video" | "audio"}/${string}`;
  bitrate: number;
  initRange: {
    start: `${number}`;
    end: `${number}`;
  };
  indexRange: {
    start: `${number}`;
    end: `${number}`;
  };
  lastModified: number;
  contentLength: `${number}`;
  averageBitrate: number;
  approxDurationMs: `${number}`;
};

/** YouTube InnerTube API — values reverse-engineered from `adaptiveFormats[].quality` in player responses. */
export const VideoQuality = {
  Tiny: "tiny",
  Medium: "medium",
  Large: "large",
  Hd720: "hd720",
  Hd1080: "hd1080",
  Hd1440: "hd1440",
  Hd2160: "hd2160",
  Hd4320: "hd4320"
} as const;

export type VideoQuality = (typeof VideoQuality)[keyof typeof VideoQuality];

/** YouTube InnerTube API — values reverse-engineered from `adaptiveFormats[].qualityLabel` in player responses. */
export const QualityLabel = {
  P144: "144p",
  P240: "240p",
  P360: "360p",
  P480: "480p",
  P720: "720p",
  P1080: "1080p",
  P1440: "1440p",
  P2160: "2160p",
  P4320: "4320p"
} as const;

export type QualityLabel = (typeof QualityLabel)[keyof typeof QualityLabel];

/** YouTube InnerTube API — values reverse-engineered from `adaptiveFormats[].audioQuality` in player responses. */
export const AudioQuality = {
  Low: "AUDIO_QUALITY_LOW",
  Medium: "AUDIO_QUALITY_MEDIUM"
} as const;

export type AudioQuality = (typeof AudioQuality)[keyof typeof AudioQuality];

/** YouTube InnerTube API — values reverse-engineered from `playabilityStatus.status` in player responses. */
export const PlayabilityStatus = {
  Ok: "OK",
  Unplayable: "UNPLAYABLE",
  LoginRequired: "LOGIN_REQUIRED",
  Error: "ERROR",
  LiveStreamOffline: "LIVE_STREAM_OFFLINE",
  AgeCheckRequired: "AGE_CHECK_REQUIRED"
} as const;

export type PlayabilityStatus = (typeof PlayabilityStatus)[keyof typeof PlayabilityStatus];

/** YouTube InnerTube API — values reverse-engineered from `streamingData.formats[]` in player responses. @see https://github.com/LuanRT/YouTube.js/blob/main/src/parser/classes/misc/Format.ts */
export type FormatItem = MediaItem & {
  width: number;
  height: number;
  quality:
    | typeof VideoQuality.Tiny
    | typeof VideoQuality.Medium
    | typeof VideoQuality.Large
    | typeof VideoQuality.Hd720;
  fps: 30;
  qualityLabel:
    | typeof QualityLabel.P144
    | typeof QualityLabel.P360
    | typeof QualityLabel.P480
    | typeof QualityLabel.P720;
  audioQuality: AudioQuality;
  audioBitrate?: number;
  projectionType: "RECTANGULAR";
  audioSampleRate: `${number}`;
  audioChannels: number;
};

/** YouTube InnerTube API — values reverse-engineered from `streamingData.adaptiveFormats[]` in player responses. @see https://github.com/LuanRT/YouTube.js/blob/main/src/parser/classes/misc/Format.ts */
export type AdaptiveFormatItem = MediaItem & {
  width?: number;
  height?: number;
  quality: VideoQuality;
  fps?: 24 | 25 | 30 | 48 | 50 | 60;
  qualityLabel?: QualityLabel | (string & {});
  averageBitrate: number;
  audioQuality?: AudioQuality;
  colorInfo?: {
    primaries: "COLOR_PRIMARIES_BT709" | "COLOR_PRIMARIES_BT2020" | (string & {});
    transferCharacteristics:
      | "COLOR_TRANSFER_CHARACTERISTICS_BT709"
      | "COLOR_TRANSFER_CHARACTERISTICS_SMPTEST2084"
      | (string & {});
    matrixCoefficients:
      | "COLOR_MATRIX_COEFFICIENTS_BT709"
      | "COLOR_MATRIX_COEFFICIENTS_BT2020_NCL"
      | (string & {});
  };
  audioTrack?: {
    id: string;
    displayName: string;
    audioIsDefault: boolean;
  };
  signatureCipher?: string;
  projectionType?: "RECTANGULAR" | "MESH";
  stereoLayout?: "STEREO_LAYOUT_LEFT_RIGHT" | "STEREO_LAYOUT_TOP_BOTTOM" | (string & {});
  spatialAudioType?: "SPATIAL_AUDIO_TYPE_AMBISONICS_5_1" | "SPATIAL_AUDIO_TYPE_AMBISONICS_QUAD" | "SPATIAL_AUDIO_TYPE_FOA_WITH_NON_DIEGETIC" | (string & {});
  highReplication?: boolean;
  audioSampleRate?: `${number}`;
  loudnessDb?: number;
  trackAbsoluteLoudnessLkfs?: number;
  audioChannels?: number;
  targetDurationSec?: number;
  maxDvrDurationSec?: number;
  type?: "FORMAT_STREAM_TYPE_OTF" | (string & {});
  drmFamilies?: string[];
  drmTrackType?: string;
  fairPlayKeyUri?: string;
  distinctParams?: string;
  xtags?: string;
};

/** @see https://github.com/LuanRT/YouTube.js/blob/main/src/parser/classes/PlayerCaptionsTracklist.ts */
export type CaptionTrack = {
  baseUrl: string;
  name: { simpleText: string };
  vssId: string;
  languageCode: string;
  kind?: string;
  isTranslatable: boolean;
};

/** @see https://github.com/LuanRT/YouTube.js/blob/main/src/parser/types/ParsedResponse.ts */
export type PlayerResponse = {
  playabilityStatus: {
    status: `${PlayabilityStatus}`;
    reason?: string;
    messages?: string[];
  };
  videoDetails?: {
    videoId: string;
    title: string;
    lengthSeconds: `${number}`;
    channelId: string;
    shortDescription: string;
    keywords?: string[];
    thumbnail: {
      thumbnails: {
        url: string;
        width: number;
        height: number;
      }[];
    };
    viewCount: `${number}`;
    author: string;
    isPrivate: boolean;
    isLiveContent?: boolean;
    isLive?: boolean;
    allowRatings: boolean;
  };
  microformat?: {
    playerMicroformatRenderer: {
      liveBroadcastDetails?: {
        isLiveNow: true;
        startTimestamp: string;
      };
      title: { simpleText: string };
      description: { simpleText: string };
      lengthSeconds: `${number}`;
      category: string;
      publishDate: `${number}-${number}-${number}`;
      ownerChannelName: string;
    };
  };
  streamingData?: {
    expiresInSeconds: `${number}`;
    formats: FormatItem[];
    adaptiveFormats: AdaptiveFormatItem[];
    serverAbrStreamingUrl?: string;
  };
  playerConfig?: {
    mediaCommonConfig?: {
      mediaUstreamerRequestConfig?: {
        videoPlaybackUstreamerConfig?: string;
      };
    };
    [key: string]: unknown;
  };
  captions?: {
    playerCaptionsTracklistRenderer: {
      captionTracks: CaptionTrack[];
    };
  };
};

/** YouTube-internal Polymer view model — values reverse-engineered from YouTube's runtime. */
export const ButtonSize = {
  Default: "BUTTON_VIEW_MODEL_SIZE_DEFAULT",
  Large: "BUTTON_VIEW_MODEL_SIZE_LARGE",
  Small: "BUTTON_VIEW_MODEL_SIZE_SMALL",
  XSmall: "BUTTON_VIEW_MODEL_SIZE_XSMALL"
} as const;

export type ButtonSize = (typeof ButtonSize)[keyof typeof ButtonSize];

/** YouTube-internal Polymer view model — values reverse-engineered from YouTube's runtime. */
export const ButtonStyle = {
  CallToAction: "BUTTON_VIEW_MODEL_STYLE_CALL_TO_ACTION",
  Custom: "BUTTON_VIEW_MODEL_STYLE_CUSTOM",
  Mono: "BUTTON_VIEW_MODEL_STYLE_MONO",
  Overlay: "BUTTON_VIEW_MODEL_STYLE_OVERLAY"
} as const;

export type ButtonStyle = (typeof ButtonStyle)[keyof typeof ButtonStyle];

/** YouTube-internal Polymer view model — values reverse-engineered from YouTube's runtime. */
export const ButtonType = {
  Filled: "BUTTON_VIEW_MODEL_TYPE_FILLED",
  Outline: "BUTTON_VIEW_MODEL_TYPE_OUTLINE",
  Text: "BUTTON_VIEW_MODEL_TYPE_TEXT",
  Tonal: "BUTTON_VIEW_MODEL_TYPE_TONAL"
} as const;

export type ButtonType = (typeof ButtonType)[keyof typeof ButtonType];

/** YouTube-internal Polymer view model — values reverse-engineered from YouTube's runtime. */
export const ButtonState = {
  Active: "BUTTON_VIEW_MODEL_STATE_ACTIVE",
  Disabled: "BUTTON_VIEW_MODEL_STATE_DISABLED"
} as const;

export type ButtonState = (typeof ButtonState)[keyof typeof ButtonState];

/** YouTube-internal Polymer view model — values reverse-engineered from YouTube's runtime. */
export const IconName = {
  None: "",
  AccessTime: "ACCESS_TIME",
  AccountBox: "ACCOUNT_BOX",
  Add: "ADD",
  BookmarkBorder: "BOOKMARK_BORDER",
  CheckCircleThick: "CHECK_CIRCLE_THICK",
  ChevronLeft: "CHEVRON_LEFT",
  ChevronRight: "CHEVRON_RIGHT",
  Close: "CLOSE",
  Comment: "COMMENT",
  ContentCut: "CONTENT_CUT",
  CreationLive: "CREATION_LIVE",
  CreationPost: "CREATION_POST",
  CreationUpload: "CREATION_UPLOAD",
  Dislike: "DISLIKE",
  Download: "DOWNLOAD",
  Downloaded: "DOWNLOADED",
  ExpandLess: "EXPAND_LESS",
  ExpandMore: "EXPAND_MORE",
  Feedback: "FEEDBACK",
  Flag: "FLAG",
  Info: "INFO",
  LaptopMobile: "LAPTOP_MOBILE",
  Like: "LIKE",
  MessageBubbleOverlap: "MESSAGE_BUBBLE_OVERLAP",
  MicrophoneOn: "MICROPHONE_ON",
  MoneyHeart: "MONEY_HEART",
  MoreVert: "MORE_VERT",
  MyVideos: "MY_VIDEOS",
  NotificationsCairo: "NOTIFICATIONS_CAIRO",
  PlaylistAdd: "PLAYLIST_ADD",
  PremiumStandaloneCairo: "PREMIUM_STANDALONE_CAIRO",
  Remove: "REMOVE",
  Search: "SEARCH",
  Share: "SHARE",
  Sort: "SORT",
  Spark: "SPARK",
  Stop: "STOP",
  Visibility: "VISIBILITY",
  VisibilityOff: "VISIBILITY_OFF",
  WatchLater: "WATCH_LATER",
  YoutubePremiumLogo: "YOUTUBE_PREMIUM_LOGO",
  YoutubeShortsBrand24: "YOUTUBE_SHORTS_BRAND_24"
} as const;

export type IconName = (typeof IconName)[keyof typeof IconName];

/**
 * Icon names for the `icon` attribute on `<yt-icon>` (iron-iconset-svg `icons:` set).
 * @see https://github.com/PolymerElements/iron-icons
 */
export const YtIconName = {
  Autorenew: "icons:autorenew",
  Check: "icons:check",
  CheckCircle: "icons:check-circle",
  Close: "icons:close",
  ErrorOutline: "icons:error-outline",
  Info: "icons:info",
  InfoOutline: "icons:info-outline",
  Language: "icons:language",
  Lock: "icons:lock",
  MicOff: "icons:mic-off",
  MoreVert: "icons:more-vert",
  Settings: "icons:settings",
  SubtitlesOutline: "icons:subtitles",
  Translate: "icons:translate",
  Warning: "icons:warning"
} as const;

export type YtIconName = (typeof YtIconName)[keyof typeof YtIconName];

/** YouTube-internal Polymer view model — values reverse-engineered from YouTube's runtime. */
export const TooltipPlacement = {
  Top: "TOOLTIP_VIEW_MODEL_PLACEMENT_TOP",
  Bottom: "TOOLTIP_VIEW_MODEL_PLACEMENT_BOTTOM",
  Left: "TOOLTIP_VIEW_MODEL_PLACEMENT_LEFT",
  Right: "TOOLTIP_VIEW_MODEL_PLACEMENT_RIGHT"
} as const;

export type TooltipPlacement = (typeof TooltipPlacement)[keyof typeof TooltipPlacement];

/** YouTube-internal Polymer view model — values reverse-engineered from YouTube's runtime. */
export const TooltipStyle = {
  Default: "TOOLTIP_VIEW_MODEL_STYLE_DEFAULT",
  Player: "TOOLTIP_VIEW_MODEL_STYLE_PLAYER"
} as const;

export type TooltipStyle = (typeof TooltipStyle)[keyof typeof TooltipStyle];

// Zod can't be used in content scripts because YouTube's Trusted Types CSP blocks it.

export function isPolymerInputElement(element: Element): element is TpYtPaperInputElement {
  return "updateStyles" in element && "label" in element;
}

interface TpYtPaperToastElement extends HTMLElement {
  open: () => void;
  text: string;
}

export function isPaperToastElement(element: Element): element is TpYtPaperToastElement {
  return "open" in element && "text" in element;
}

/** YouTube-internal Polymer view model — values reverse-engineered from YouTube's runtime. */
export interface YtButtonViewModelElement extends HTMLElement {
  data: ButtonViewModelData;
}

/** @see https://github.com/PolymerElements/paper-dropdown-menu */
interface TpYtPaperDropdownMenuElement extends HTMLElement {
  receivedFocusFromKeyboard: boolean;
}

/** @see https://github.com/PolymerElements/paper-progress */
export interface TpYtPaperProgressElement extends HTMLElement {
  value: number;
  max: number;
  indeterminate: boolean;
  updateStyles(styles: Record<string, string>): void;
}

/** @see https://github.com/PolymerElements/paper-input */
export interface TpYtPaperInputElement extends HTMLElement {
  updateStyles(styles: Record<string, string>): void;
}

/** @see https://github.com/PolymerElements/iron-dropdown */
export interface TpYtIronDropdownElement extends HTMLElement {
  positionTarget: Element | null;
  horizontalAlign: "left" | "right" | "center";
  verticalAlign: "top" | "bottom";
  noOverlap: boolean;
  dynamicAlign: boolean;
  allowOutsideScroll: boolean;
  restoreFocusOnClose: boolean;
  opened: boolean;
  open(): void;
  close(): void;
  refit(): void;
}

declare global {
  interface HTMLVideoElement {
    // audioTracks is supported in all modern browsers but absent from some TS lib versions
    audioTracks?: {
      readonly length: number;
      [index: number]: {
        enabled: boolean;
        language: string;
        id: string;
      };
      [Symbol.iterator](): IterableIterator<{
        enabled: boolean;
        language: string;
        id: string;
      }>;
    };
  }

  interface HTMLElementTagNameMap {
    "yt-button-view-model": YtButtonViewModelElement;
    "tp-yt-paper-dropdown-menu": TpYtPaperDropdownMenuElement;
    "tp-yt-paper-progress": TpYtPaperProgressElement;
    "tp-yt-paper-input": TpYtPaperInputElement;
    "tp-yt-iron-dropdown": TpYtIronDropdownElement;
    "tp-yt-paper-listbox": HTMLElement;
    "tp-yt-paper-item": HTMLElement;
  }

  interface Window {
    __ytdlCapture: YtdlCaptureState;
  }
}

export interface YtdlMediaCapture {
  videoChunks: Uint8Array[];
  audioChunks: Uint8Array[];
  videoMimeType: string;
  audioMimeType: string;
  videoTotalBytes: number;
  audioTotalBytes: number;
}

export interface YtdlCaptureState {
  activeVideoId: string;
  pendingChunks: Array<{
    mimeType: string;
    data: Uint8Array;
  }>;
  capturedMedia: Map<string, YtdlMediaCapture>;
  sourceBufferMimeTypes: WeakMap<SourceBuffer, string>;
  addChunkToCapture: (args: {
    capture: YtdlMediaCapture;
    mimeType: string;
    chunk: Uint8Array;
  }) => void;
}
