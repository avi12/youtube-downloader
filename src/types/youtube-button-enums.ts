import type { ButtonViewModelData } from "@/lib/ui/polymer-utils";

export type { ButtonViewModelData };

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
