import type { Prettify } from "./prettify";
import { z } from "@/lib/zod";

const byteRangeSchema = z.looseObject({
  start: z.string(),
  end: z.string()
});

const mediaItemSchema = z.looseObject({
  itag: z.number(),
  url: z.string().optional(),
  mimeType: z.string(),
  bitrate: z.number(),
  initRange: byteRangeSchema.optional(),
  indexRange: byteRangeSchema.optional(),
  lastModified: z.union([z.string(), z.number()]).optional(),
  contentLength: z.string().optional(),
  averageBitrate: z.number().optional(),
  approxDurationMs: z.string().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  quality: z.string().optional(),
  fps: z.number().optional(),
  qualityLabel: z.string().optional(),
  audioQuality: z.string().optional(),
  audioSampleRate: z.string().optional(),
  audioChannels: z.number().optional(),
  projectionType: z.string().optional()
});

/** YouTube InnerTube API -values reverse-engineered from `streamingData.formats[]` in player responses. @see https://github.com/LuanRT/YouTube.js/blob/main/src/parser/classes/misc/Format.ts */
export const formatItemSchema = mediaItemSchema.extend({
  audioBitrate: z.number().optional()
});

/** YouTube InnerTube API -values reverse-engineered from `streamingData.adaptiveFormats[]` in player responses. @see https://github.com/LuanRT/YouTube.js/blob/main/src/parser/classes/misc/Format.ts */
export const adaptiveFormatSchema = mediaItemSchema.extend({
  colorInfo: z.looseObject({
    primaries: z.string().optional(),
    transferCharacteristics: z.string().optional(),
    matrixCoefficients: z.string().optional()
  }).optional(),
  audioTrack: z.looseObject({
    id: z.string(),
    displayName: z.string(),
    audioIsDefault: z.boolean()
  }).optional(),
  signatureCipher: z.string().optional(),
  stereoLayout: z.string().optional(),
  spatialAudioType: z.string().optional(),
  highReplication: z.boolean().optional(),
  loudnessDb: z.number().optional(),
  trackAbsoluteLoudnessLkfs: z.number().optional(),
  targetDurationSec: z.number().optional(),
  maxDvrDurationSec: z.number().optional(),
  type: z.string().optional(),
  drmFamilies: z.array(z.string()).optional(),
  drmTrackType: z.string().optional(),
  fairPlayKeyUri: z.string().optional(),
  distinctParams: z.string().optional(),
  xtags: z.string().optional()
});

// The desktop site sends plain text, the mobile site sends the same text as runs
const playerTextSchema = z.looseObject({
  simpleText: z.string().optional(),
  runs: z.array(
    z.looseObject({ text: z.string() })
  ).optional()
});

const plainTextSchema = z.looseObject({
  simpleText: z.string()
});

export const playerTranslationLanguageSchema = z.looseObject({
  languageCode: z.string(),
  languageName: playerTextSchema
});

export const translationLanguageSchema = playerTranslationLanguageSchema.extend({
  languageName: plainTextSchema
});

export const playerCaptionTrackSchema = z.looseObject({
  baseUrl: z.string(),
  name: playerTextSchema,
  vssId: z.string(),
  languageCode: z.string(),
  kind: z.string().optional(),
  isTranslatable: z.boolean().optional(),
  translationLanguageCode: z.string().optional(),
  sourceTrackVssId: z.string().optional()
});

/** @see https://github.com/LuanRT/YouTube.js/blob/main/src/parser/classes/PlayerCaptionsTracklist.ts */
export const captionTrackSchema = playerCaptionTrackSchema.extend({
  name: plainTextSchema
});

export type AdaptiveFormatItem = Prettify<z.infer<typeof adaptiveFormatSchema>>;

export type TranslationLanguage = Prettify<z.infer<typeof translationLanguageSchema>>;

export type CaptionTrack = Prettify<z.infer<typeof captionTrackSchema>>;

export type PlayerText = Prettify<z.infer<typeof playerTextSchema>>;
