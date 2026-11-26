import { z } from "@/lib/zod";
import { tolerated } from "@/lib/zod-guard";
import type { Prettify } from "@/types";
import { videoMetadataSchema } from "@/types/settings-types";

export enum WorkerMessageType {
  Init = "init",
  Ready = "ready",
  MuxVideoAudio = "muxVideoAudio",
  EmbedMetadata = "embedMetadata",
  TranscodeAudio = "transcodeAudio",
  TranscodeFile = "transcodeFile",
  Result = "result",
  ResultFile = "resultFile",
  Error = "error",
  Progress = "progress"
}

export enum FFmpegCoreBuild {
  Simd = "simd",
  NoSimd = "noSimd"
}

// Binary fields are checked by class only, so validating a job never reads or copies its bytes
const arrayBufferSchema = z.instanceof(ArrayBuffer);
const bytesSchema: z.ZodType<Uint8Array> = z.instanceof(Uint8Array);

// Names come from YouTube data that is let through unchecked, so a missing one must not fail the job
const trackNameSchema = z.string().catch("");

const baseWorkerJobSchema = z.object({
  videoId: z.string(),
  tabId: z.number(),
  filenameOutput: z.string()
});

const audioTrackSchema = z.object({
  data: arrayBufferSchema,
  label: trackNameSchema,
  languageCode: trackNameSchema
});

export const muxVideoAudioJobSchema = baseWorkerJobSchema.extend({
  videoData: arrayBufferSchema.nullable(),
  videoFile: z.instanceof(File).optional(),
  audioTracks: z.array(audioTrackSchema),
  subtitleTracks: z.array(
    z.object({
      data: bytesSchema,
      label: trackNameSchema,
      languageCode: trackNameSchema
    })
  ),
  videoMimeType: z.string(),
  audioMimeType: z.string(),
  defaultAudioTrackIndex: z.number()
});

export const embedMetadataJobSchema = baseWorkerJobSchema.extend({
  audioData: arrayBufferSchema,
  sourceExtension: z.string(),
  audioMimeType: tolerated(z.string()),
  metadata: videoMetadataSchema,
  thumbnailUrl: tolerated(z.string())
});

export const transcodeAudioJobSchema = baseWorkerJobSchema.extend({
  audioData: arrayBufferSchema,
  sourceExtension: z.string()
});

export const transcodeFileJobSchema = z.object({
  videoId: z.string(),
  tabId: z.number(),
  data: arrayBufferSchema,
  sourceExtension: z.string(),
  targetContainer: z.string(),
  audioMimeType: tolerated(z.string()),
  videoMimeType: tolerated(z.string()),
  coverArtUrl: tolerated(z.string())
});

export type AudioTrack = Prettify<z.infer<typeof audioTrackSchema>>;
export type MuxVideoAudioJob = Prettify<z.infer<typeof muxVideoAudioJobSchema>>;
export type EmbedMetadataJob = Prettify<z.infer<typeof embedMetadataJobSchema>>;
export type TranscodeAudioJob = Prettify<z.infer<typeof transcodeAudioJobSchema>>;
export type TranscodeFileJob = Prettify<z.infer<typeof transcodeFileJobSchema>>;
