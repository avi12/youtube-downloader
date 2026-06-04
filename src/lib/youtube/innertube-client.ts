import type { Prettify } from "@/types";

export const InnertubeClientName = {
  Web: "WEB",
  WebEmbeddedPlayer: "WEB_EMBEDDED_PLAYER",
  WebRemix: "WEB_REMIX",
  WebKids: "WEB_KIDS",
  Mweb: "MWEB",
  Android: "ANDROID",
  AndroidEmbeddedPlayer: "ANDROID_EMBEDDED_PLAYER",
  AndroidMusic: "ANDROID_MUSIC",
  AndroidKids: "ANDROID_KIDS",
  Ios: "IOS",
  IosMusic: "IOS_MUSIC",
  IosKids: "IOS_KIDS",
  TvHtml5: "TVHTML5",
  TvHtml5SimplyEmbeddedPlayer: "TVHTML5_SIMPLY_EMBEDDED_PLAYER"
} as const;

export type InnertubeClientName = (typeof InnertubeClientName)[keyof typeof InnertubeClientName] | (string & {});

export type InnertubeClientContext = Prettify<{
  clientName: InnertubeClientName;
  clientVersion: string;
  hl?: string;
  gl?: string;
  userAgent?: string;
  osName?: "Windows" | "Macintosh" | "X11" | "Android" | "iPhone" | "iPad" | (string & {});
  osVersion?: string;
  platform?: "DESKTOP" | "MOBILE" | "TV";
  clientFormFactor?:
    | "UNKNOWN_FORM_FACTOR"
    | "SMALL_FORM_FACTOR"
    | "LARGE_FORM_FACTOR"
    | "AUTOMOTIVE_FORM_FACTOR"
    | "WEARABLE_FORM_FACTOR"
    | (string & {});
  deviceMake?: string;
  deviceModel?: string;
  visitorData?: string;
  androidSdkVersion?: number;
  iosVersion?: string;
  timeZone?: string;
  utcOffsetMinutes?: number;
  screenDensityFloat?: number;
  screenWidthPoints?: number;
  screenHeightPoints?: number;
  originalUrl?: `https://${string}`;
  mainAppWebInfo?: {
    graftUrl?: `/${string}`;
    webDisplayMode?:
      | "WEB_DISPLAY_MODE_BROWSER"
      | "WEB_DISPLAY_MODE_FULLSCREEN"
      | "WEB_DISPLAY_MODE_MINIMAL_UI"
      | "WEB_DISPLAY_MODE_STANDALONE";
    isWebNativeShareAvailable?: boolean;
  };
}>;

export type InnertubeContext = Prettify<{
  client: InnertubeClientContext;
  user?: {
    lockedSafetyMode?: boolean;
    onBehalfOfUser?: string;
  };
  request?: {
    useSsl?: boolean;
    internalExperimentFlags?: unknown[];
  };
  clickTracking?: {
    clickTrackingParams?: string;
  };
  adSignalsInfo?: {
    params?: Array<{
      key: string;
      value: string;
    }>;
  };
}>;

export type InnertubeContentPlaybackContext = Prettify<{
  signatureTimestamp?: number;
  currentUrl?: `https://${string}` | `/${string}`;
  referer?: `https://${string}`;
  signatureCipher?: string;
  vis?: number;
  splay?: boolean;
  lactMilliseconds?: `${number}`;
  playerWidthPixels?: number;
  playerHeightPixels?: number;
  html5Preference?: "HTML5_PREF_WANTS" | "HTML5_PREF_OK";
  autoCaptionsDefaultOn?: boolean;
  autonavState?: "STATE_NONE" | "STATE_ON" | "STATE_OFF";
  mdxContext?: unknown;
}>;
