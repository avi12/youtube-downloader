/**
 * Request body shapes for YouTube's internal InnerTube endpoints
 * (`/youtubei/v1/player`, `/youtubei/v1/browse`, ...).
 *
 * The endpoints accept many more fields than what this project currently sends;
 * optional members below cover commonly-recognized parameters from the web
 * client so callers can opt into them without re-typing the schema. Required
 * members reflect what YouTube actually validates server-side.
 *
 * Reference: not officially documented by YouTube. Field names mirror the names
 * used by youtubei.js / yt-dlp / Innertube reverse-engineering communities.
 */

/**
 * Known YouTube InnerTube client names. The `(string & {})` tail on the type
 * keeps the known values as autocomplete suggestions while leaving the field
 * open to new clients YouTube may roll out without forcing a type bump.
 *
 * @see https://github.com/zerodytrash/YouTube-Internal-Clients — community-maintained list of known client IDs and versions
 */
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

export interface InnertubeContext {
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
}

export interface InnertubePlayerRequest {
  videoId: string;
  context: InnertubeContext;
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

/**
 * `/youtubei/v1/browse` request body.
 *
 * @see https://github.com/LuanRT/YouTube.js — community-maintained TypeScript bindings for InnerTube
 * @see https://github.com/yt-dlp/yt-dlp — yt-dlp source for cross-referencing field semantics
 */
export interface InnertubeBrowseRequest {
  // Known browseId prefixes: `FE*` features, `UC*` channels, `VL*` playlists,
  // `MPLA*` music playlists, `MPRE*` music releases.
  browseId: `FE${string}` | `UC${string}` | `VL${string}` | `MPLA${string}` | `MPRE${string}` | (string & {});
  context: InnertubeContext;
  params?: string;
  continuation?: string;
  query?: string;
  formData?: {
    selectedValues?: string[];
  };
  inlineSettingsMenu?: boolean;
}

export interface InnertubeClientContext {
  clientName: InnertubeClientName;
  clientVersion: string;
  /**
   * IETF BCP 47 language tag (e.g. "en", "en-GB").
   * @see https://www.rfc-editor.org/rfc/bcp/bcp47.txt
   */
  hl?: string;
  /**
   * ISO 3166-1 alpha-2 country code (e.g. "US", "GB").
   * @see https://www.iso.org/iso-3166-country-codes.html
   */
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
  /**
   * IANA tz database identifier (e.g. "America/New_York").
   * @see https://www.iana.org/time-zones
   */
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
}

export interface InnertubeContentPlaybackContext {
  signatureTimestamp?: number;
  currentUrl?: `https://${string}` | `/${string}`;
  referer?: `https://${string}`;
  signatureCipher?: string;
  vis?: number;
  splay?: boolean;
  /**
   * "Last activity time" in milliseconds (YouTube's `lact` abbreviation).
   * Stringified int64 per the underlying proto: `lact_milliseconds = 5`.
   * Conventionally `'-1'` when the client has no prior activity to report.
   */
  lactMilliseconds?: `${number}`;
  playerWidthPixels?: number;
  playerHeightPixels?: number;
  html5Preference?: "HTML5_PREF_WANTS" | "HTML5_PREF_OK";
  autoCaptionsDefaultOn?: boolean;
  autonavState?: "STATE_NONE" | "STATE_ON" | "STATE_OFF";
  mdxContext?: unknown;
}
