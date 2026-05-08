/**
 * Request body shape for YouTube's internal `/youtubei/v1/player` InnerTube endpoint.
 *
 * The endpoint accepts many more fields than what this project currently sends;
 * the optional members below cover the commonly-recognized parameters from the
 * web client so callers can opt into them without re-typing the schema. Required
 * members reflect what YouTube actually validates server-side.
 *
 * Reference: not officially documented by YouTube. Field names mirror the names
 * used by youtubei.js / yt-dlp / Innertube reverse-engineering communities.
 */
export interface InnertubePlayerRequest {
  videoId: string;
  context: {
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
      params?: Array<{ key: string; value: string }>;
    };
  };
  playbackContext?: {
    contentPlaybackContext: InnertubeContentPlaybackContext;
  };
  contentCheckOk?: boolean;
  racyCheckOk?: boolean;
  cpn?: string;
  serviceIntegrityDimensions?: {
    poToken?: string;
  };
  attestationRequest?: {
    omitBotguardData?: boolean;
  };
  params?: string;
  playlistId?: string;
  startTimeSecs?: number;
}

// Known YouTube InnerTube client names. The `(string & {})` tail keeps the
// known values as autocomplete suggestions while leaving the field open to
// new clients YouTube may roll out without forcing a type bump.
type InnertubeClientName =
  | "WEB"
  | "WEB_EMBEDDED_PLAYER"
  | "WEB_REMIX"
  | "WEB_KIDS"
  | "MWEB"
  | "ANDROID"
  | "ANDROID_EMBEDDED_PLAYER"
  | "ANDROID_MUSIC"
  | "ANDROID_KIDS"
  | "IOS"
  | "IOS_MUSIC"
  | "IOS_KIDS"
  | "TVHTML5"
  | "TVHTML5_SIMPLY_EMBEDDED_PLAYER"
  | (string & {});

type InnertubeOsName = "Windows" | "Macintosh" | "X11" | "Android" | "iPhone" | "iPad" | (string & {});

type InnertubeClientFormFactor =
  | "UNKNOWN_FORM_FACTOR"
  | "SMALL_FORM_FACTOR"
  | "LARGE_FORM_FACTOR"
  | "AUTOMOTIVE_FORM_FACTOR"
  | "WEARABLE_FORM_FACTOR"
  | (string & {});

type InnertubeWebDisplayMode =
  | "WEB_DISPLAY_MODE_BROWSER"
  | "WEB_DISPLAY_MODE_FULLSCREEN"
  | "WEB_DISPLAY_MODE_MINIMAL_UI"
  | "WEB_DISPLAY_MODE_STANDALONE";

// IETF BCP 47 language tag (e.g. "en", "en-GB"). Open by design.
type LanguageTag = `${string}` & (string & {});

// ISO 3166-1 alpha-2 country code (e.g. "US", "GB"). Open by design.
type CountryCode = `${string}` & (string & {});

// IANA tz database identifier (e.g. "America/New_York").
type TimeZoneId = `${string}/${string}` | "UTC" | (string & {});

// Stringified integer (YouTube serializes some int64-shaped fields as strings).
type StringNumber = `${number}`;

export interface InnertubeClientContext {
  clientName: InnertubeClientName;
  clientVersion: string;
  hl?: LanguageTag;
  gl?: CountryCode;
  userAgent?: string;
  osName?: InnertubeOsName;
  osVersion?: string;
  platform?: "DESKTOP" | "MOBILE" | "TV";
  clientFormFactor?: InnertubeClientFormFactor;
  deviceMake?: string;
  deviceModel?: string;
  visitorData?: string;
  androidSdkVersion?: number;
  iosVersion?: string;
  timeZone?: TimeZoneId;
  utcOffsetMinutes?: number;
  screenDensityFloat?: number;
  screenWidthPoints?: number;
  screenHeightPoints?: number;
  originalUrl?: `https://${string}`;
  mainAppWebInfo?: {
    graftUrl?: `/${string}`;
    webDisplayMode?: InnertubeWebDisplayMode;
    isWebNativeShareAvailable?: boolean;
  };
}

export interface InnertubeContentPlaybackContext {
  signatureTimestamp?: number;
  currentUrl?: `https://${string}` | `/${string}`;
  referer?: `https://${string}`;
  signatureCipher?: string;
  vis?: number;
  splay?: boolean;
  lactMilliseconds?: StringNumber;
  playerWidthPixels?: number;
  playerHeightPixels?: number;
  html5Preference?: "HTML5_PREF_WANTS" | "HTML5_PREF_OK";
  autoCaptionsDefaultOn?: boolean;
  autonavState?: "STATE_NONE" | "STATE_ON" | "STATE_OFF";
  mdxContext?: unknown;
}
