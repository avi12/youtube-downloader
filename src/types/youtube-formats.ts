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

const VideoQuality = {
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

const QualityLabel = {
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

const AudioQuality = {
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
