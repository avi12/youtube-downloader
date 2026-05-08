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

export interface InnertubeClientContext {
  clientName: string;
  clientVersion: string;
  hl?: string;
  gl?: string;
  userAgent?: string;
  osName?: string;
  osVersion?: string;
  platform?: "DESKTOP" | "MOBILE" | "TV";
  clientFormFactor?: string;
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
  originalUrl?: string;
  mainAppWebInfo?: {
    graftUrl?: string;
    webDisplayMode?: string;
    isWebNativeShareAvailable?: boolean;
  };
}

export interface InnertubeContentPlaybackContext {
  signatureTimestamp?: number;
  currentUrl?: string;
  referer?: string;
  signatureCipher?: string;
  vis?: number;
  splay?: boolean;
  lactMilliseconds?: string;
  playerWidthPixels?: number;
  playerHeightPixels?: number;
  html5Preference?: "HTML5_PREF_WANTS" | "HTML5_PREF_OK";
  autoCaptionsDefaultOn?: boolean;
  autonavState?: "STATE_NONE" | "STATE_ON" | "STATE_OFF";
  mdxContext?: unknown;
}
