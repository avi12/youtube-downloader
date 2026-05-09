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

export const AudioQuality = {
  Low: "AUDIO_QUALITY_LOW",
  Medium: "AUDIO_QUALITY_MEDIUM"
} as const;

export type AudioQuality = (typeof AudioQuality)[keyof typeof AudioQuality];

export const PlayabilityStatus = {
  Ok: "OK",
  Unplayable: "UNPLAYABLE",
  LoginRequired: "LOGIN_REQUIRED",
  Error: "ERROR",
  LiveStreamOffline: "LIVE_STREAM_OFFLINE",
  AgeCheckRequired: "AGE_CHECK_REQUIRED"
} as const;

export type PlayabilityStatus = (typeof PlayabilityStatus)[keyof typeof PlayabilityStatus];

export type FormatItem = MediaItem & {
  width: number;
  height: number;
  quality: typeof VideoQuality.Tiny | typeof VideoQuality.Medium | typeof VideoQuality.Hd720;
  fps: 30;
  qualityLabel:
    | typeof QualityLabel.P144
    | typeof QualityLabel.P360
    | typeof QualityLabel.P480
    | typeof QualityLabel.P720;
  audioQuality: AudioQuality;
  projectionType: "RECTANGULAR";
  audioSampleRate: `${number}`;
  audioChannels: number;
};

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
    transferCharacteristics: "COLOR_TRANSFER_CHARACTERISTICS_BT709" | "COLOR_TRANSFER_CHARACTERISTICS_SMPTEST2084" | (string & {});
    matrixCoefficients: "COLOR_MATRIX_COEFFICIENTS_BT709" | "COLOR_MATRIX_COEFFICIENTS_BT2020_NCL" | (string & {});
  };
  audioTrack?: {
    id: string;
    displayName: string;
    audioIsDefault: boolean;
  };
  signatureCipher?: string;
  projectionType?: "RECTANGULAR" | "MESH";
  highReplication?: boolean;
  audioSampleRate?: `${number}`;
  loudnessDb?: number;
  audioChannels?: number;
  xtags?: string;
};

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
};

export const ButtonSize = {
  Default: "BUTTON_VIEW_MODEL_SIZE_DEFAULT",
  Large: "BUTTON_VIEW_MODEL_SIZE_LARGE",
  Small: "BUTTON_VIEW_MODEL_SIZE_SMALL",
  XSmall: "BUTTON_VIEW_MODEL_SIZE_XSMALL"
} as const;

export type ButtonSize = (typeof ButtonSize)[keyof typeof ButtonSize];

export const ButtonStyle = {
  CallToAction: "BUTTON_VIEW_MODEL_STYLE_CALL_TO_ACTION",
  Custom: "BUTTON_VIEW_MODEL_STYLE_CUSTOM",
  Mono: "BUTTON_VIEW_MODEL_STYLE_MONO",
  Overlay: "BUTTON_VIEW_MODEL_STYLE_OVERLAY"
} as const;

export type ButtonStyle = (typeof ButtonStyle)[keyof typeof ButtonStyle];

export const ButtonType = {
  Filled: "BUTTON_VIEW_MODEL_TYPE_FILLED",
  Outline: "BUTTON_VIEW_MODEL_TYPE_OUTLINE",
  Text: "BUTTON_VIEW_MODEL_TYPE_TEXT",
  Tonal: "BUTTON_VIEW_MODEL_TYPE_TONAL"
} as const;

export type ButtonType = (typeof ButtonType)[keyof typeof ButtonType];

export const ButtonState = {
  Active: "BUTTON_VIEW_MODEL_STATE_ACTIVE",
  Disabled: "BUTTON_VIEW_MODEL_STATE_DISABLED"
} as const;

export type ButtonState = (typeof ButtonState)[keyof typeof ButtonState];

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
  Visibility: "VISIBILITY",
  VisibilityOff: "VISIBILITY_OFF",
  WatchLater: "WATCH_LATER",
  YoutubePremiumLogo: "YOUTUBE_PREMIUM_LOGO",
  YoutubeShortsBrand24: "YOUTUBE_SHORTS_BRAND_24"
} as const;

export type IconName = (typeof IconName)[keyof typeof IconName];

export const TooltipPlacement = {
  Top: "TOOLTIP_VIEW_MODEL_PLACEMENT_TOP"
} as const;

export type TooltipPlacement = (typeof TooltipPlacement)[keyof typeof TooltipPlacement];

export const TooltipStyle = {
  Player: "TOOLTIP_VIEW_MODEL_STYLE_PLAYER"
} as const;

export type TooltipStyle = (typeof TooltipStyle)[keyof typeof TooltipStyle];

// Zod can't be used in content scripts because YouTube's Trusted Types CSP blocks it.

export function isPolymerProgressElement(element: Element): element is TpYtPaperProgressElement {
  return "updateStyles" in element && "value" in element;
}

export interface YtButtonViewModelElement extends HTMLElement {
  data: ButtonViewModelData;
}

interface TpYtPaperDropdownMenuElement extends HTMLElement {
  receivedFocusFromKeyboard: boolean;
}

export interface TpYtPaperProgressElement extends HTMLElement {
  value: number;
  max: number;
  indeterminate: boolean;
  updateStyles(styles: Record<string, string>): void;
}

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
  interface HTMLElementTagNameMap {
    "yt-button-view-model": YtButtonViewModelElement;
    "tp-yt-paper-dropdown-menu": TpYtPaperDropdownMenuElement;
    "tp-yt-paper-progress": TpYtPaperProgressElement;
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
