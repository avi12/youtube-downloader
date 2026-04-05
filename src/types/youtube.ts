// Types describing YouTube's API responses and Polymer runtime elements.
// These are not our own types - they mirror shapes defined by YouTube.

type Thumbnail = {
  thumbnails: { url: string;
    width: number;
    height: number; }[];
};

export type MediaItem = {
  itag: number;
  url?: string;
  mimeType: `${"video" | "audio"}/${string}`;
  bitrate: number;
  initRange: { start: "0";
    end: `${number}`; };
  indexRange: { start: `${number}`;
    end: `${number}`; };
  lastModified: number;
  contentLength: `${number}`;
  averageBitrate: number;
  approxDurationMs: `${number}`;
};

export enum VideoQuality {
  Tiny = "tiny",
  Medium = "medium",
  Large = "large",
  Hd720 = "hd720",
  Hd1080 = "hd1080",
  Hd1440 = "hd1440",
  Hd2160 = "hd2160",
  Hd4320 = "hd4320"
}

export enum QualityLabel {
  P144 = "144p",
  P240 = "240p",
  P360 = "360p",
  P480 = "480p",
  P720 = "720p",
  P1080 = "1080p",
  P1440 = "1440p",
  P2160 = "2160p",
  P4320 = "4320p"
}

export enum AudioQuality {
  Low = "AUDIO_QUALITY_LOW",
  Medium = "AUDIO_QUALITY_MEDIUM"
}

export enum PlayabilityStatus {
  Ok = "OK",
  Unplayable = "UNPLAYABLE",
  LoginRequired = "LOGIN_REQUIRED",
  Error = "ERROR",
  LiveStreamOffline = "LIVE_STREAM_OFFLINE",
  AgeCheckRequired = "AGE_CHECK_REQUIRED"
}

export type FormatItem = MediaItem & {
  width: number;
  height: number;
  quality: VideoQuality.Tiny | VideoQuality.Medium | VideoQuality.Hd720;
  fps: 30;
  qualityLabel: QualityLabel.P144 | QualityLabel.P360 | QualityLabel.P480 | QualityLabel.P720;
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
    thumbnail: Thumbnail;
    viewCount: `${number}`;
    author: string;
    isPrivate: boolean;
    isLiveContent?: boolean;
    isLive?: boolean;
    allowRatings: boolean;
  };
  microformat?: {
    playerMicroformatRenderer: {
      liveBroadcastDetails?: { isLiveNow: true;
        startTimestamp: string; };
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

// -- YouTube Polymer button view model ----------------------------------------

export enum ButtonSize {
  Default = "BUTTON_VIEW_MODEL_SIZE_DEFAULT",
  Large = "BUTTON_VIEW_MODEL_SIZE_LARGE",
  Small = "BUTTON_VIEW_MODEL_SIZE_SMALL",
  XSmall = "BUTTON_VIEW_MODEL_SIZE_XSMALL"
}

export enum ButtonStyle {
  CallToAction = "BUTTON_VIEW_MODEL_STYLE_CALL_TO_ACTION",
  Custom = "BUTTON_VIEW_MODEL_STYLE_CUSTOM",
  Mono = "BUTTON_VIEW_MODEL_STYLE_MONO",
  Overlay = "BUTTON_VIEW_MODEL_STYLE_OVERLAY"
}

export enum ButtonType {
  Filled = "BUTTON_VIEW_MODEL_TYPE_FILLED",
  Outline = "BUTTON_VIEW_MODEL_TYPE_OUTLINE",
  Text = "BUTTON_VIEW_MODEL_TYPE_TEXT",
  Tonal = "BUTTON_VIEW_MODEL_TYPE_TONAL"
}

export enum ButtonState {
  Active = "BUTTON_VIEW_MODEL_STATE_ACTIVE",
  Disabled = "BUTTON_VIEW_MODEL_STATE_DISABLED"
}

export enum IconName {
  AccessTime = "ACCESS_TIME",
  AccountBox = "ACCOUNT_BOX",
  Add = "ADD",
  BookmarkBorder = "BOOKMARK_BORDER",
  CheckCircleThick = "CHECK_CIRCLE_THICK",
  ChevronLeft = "CHEVRON_LEFT",
  ChevronRight = "CHEVRON_RIGHT",
  Close = "CLOSE",
  Comment = "COMMENT",
  ContentCut = "CONTENT_CUT",
  CreationLive = "CREATION_LIVE",
  CreationPost = "CREATION_POST",
  CreationUpload = "CREATION_UPLOAD",
  Dislike = "DISLIKE",
  Download = "DOWNLOAD",
  Downloaded = "DOWNLOADED",
  ExpandLess = "EXPAND_LESS",
  ExpandMore = "EXPAND_MORE",
  Feedback = "FEEDBACK",
  Flag = "FLAG",
  Info = "INFO",
  LaptopMobile = "LAPTOP_MOBILE",
  Like = "LIKE",
  MessageBubbleOverlap = "MESSAGE_BUBBLE_OVERLAP",
  MicrophoneOn = "MICROPHONE_ON",
  MoneyHeart = "MONEY_HEART",
  MoreVert = "MORE_VERT",
  MyVideos = "MY_VIDEOS",
  NotificationsCairo = "NOTIFICATIONS_CAIRO",
  PlaylistAdd = "PLAYLIST_ADD",
  PremiumStandaloneCairo = "PREMIUM_STANDALONE_CAIRO",
  Remove = "REMOVE",
  Search = "SEARCH",
  Share = "SHARE",
  Sort = "SORT",
  Spark = "SPARK",
  Visibility = "VISIBILITY",
  VisibilityOff = "VISIBILITY_OFF",
  WatchLater = "WATCH_LATER",
  YoutubePremiumLogo = "YOUTUBE_PREMIUM_LOGO",
  YoutubeShortsBrand24 = "YOUTUBE_SHORTS_BRAND_24"
}

export enum TooltipPlacement {
  Top = "TOOLTIP_VIEW_MODEL_PLACEMENT_TOP"
}

export enum TooltipStyle {
  Player = "TOOLTIP_VIEW_MODEL_STYLE_PLAYER"
}

export type ButtonViewModelData = {
  // Required display properties
  accessibilityText: string;
  buttonSize: ButtonSize;
  style: ButtonStyle;
  type: ButtonType;

  // Display
  iconName?: IconName | (string & {});
  iconImage?: { url: string;
    width: number;
    height: number; };
  title?: string;
  tooltip?: string;
  tooltipData?: {
    tooltipViewModel?: {
      tooltipText: string;
      placement: TooltipPlacement;
      style: TooltipStyle;
    };
  };

  // State and layout
  state?: ButtonState;
  isDisabled?: boolean;
  isFullWidth?: boolean;
  enableFullWidthMargins?: boolean;
  enableIconButton?: boolean;

  // Accessibility
  accessibilityId?: string;

  // Interaction
  onTap?: Record<string, unknown>;
  targetId?: string;

  // Tracking
  trackingParams?: string;
  shouldLogGestures?: boolean;
  useYoutubeLoggingDirectives?: boolean;
  loggingDirectives?: Record<string, unknown>;
};

// ─── Polymer element type guards ─────────────────────────────────────────────
// Runtime checks for YouTube's Polymer custom elements. Zod can't be used
// in content scripts because YouTube's Trusted Types CSP blocks it.

export function isPolymerProgressElement(element: Element): element is TpYtPaperProgressElement {
  return "updateStyles" in element && "value" in element;
}

export interface YtButtonViewModelElement extends HTMLElement {
  data: ButtonViewModelData;
}

export interface TpYtPaperDropdownMenuElement extends HTMLElement {
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
  horizontalAlign: "left" | "right";
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
}
