/** YouTube InnerTube API -values reverse-engineered from `adaptiveFormats[].quality` in player responses. */
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

/** YouTube InnerTube API -values reverse-engineered from `adaptiveFormats[].qualityLabel` in player responses. */
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

/** YouTube InnerTube API -values reverse-engineered from `adaptiveFormats[].audioQuality` in player responses. */
export const AudioQuality = {
  Low: "AUDIO_QUALITY_LOW",
  Medium: "AUDIO_QUALITY_MEDIUM"
} as const;

export type AudioQuality = (typeof AudioQuality)[keyof typeof AudioQuality];

/** YouTube InnerTube API -values reverse-engineered from `playabilityStatus.status` in player responses. */
export const PlayabilityStatus = {
  Ok: "OK",
  Unplayable: "UNPLAYABLE",
  LoginRequired: "LOGIN_REQUIRED",
  Error: "ERROR",
  LiveStreamOffline: "LIVE_STREAM_OFFLINE",
  AgeCheckRequired: "AGE_CHECK_REQUIRED"
} as const;

export type PlayabilityStatus = (typeof PlayabilityStatus)[keyof typeof PlayabilityStatus];
