import type { VideoQuality, QualityLabel, AudioQuality } from "./youtube-format-enums";

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
