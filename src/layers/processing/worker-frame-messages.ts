import type { ProcessStreamEndData } from "@/lib/messaging/offscreen-messaging";
import { z } from "@/lib/zod";
import { createShapeGuard } from "@/lib/zod-guard";
import type { DownloadRequest, Prettify, VideoMetadata } from "@/types";

/** Sent by a download-worker iframe to the offscreen page that hosts it */
export enum WorkerMessageKind {
  Chunk = "worker-chunk",
  StreamEnd = "worker-stream-end",
  Complete = "worker-complete",
  NeedsDirectUrl = "worker-needs-direct-url",
  NeedsFallback = "worker-needs-fallback",
  DiscardStreams = "worker-discard-streams",
  Error = "worker-error"
}

/** Sent by the offscreen page to a download-worker iframe */
export enum FrameCommandKind {
  Start = "start",
  Cancel = "cancel"
}

// Shared types owned by `@/types` and the messaging layer: only what routing relies on is checked
const sharedPayloadSchema = z.looseObject({
  videoId: z.string()
});

const chunkSchema = z.object({
  type: z.literal(WorkerMessageKind.Chunk),
  videoId: z.string(),
  streamType: z.string(),
  iChunk: z.number(),
  tabId: z.number(),
  buffer: z.instanceof(ArrayBuffer)
});

const streamEndSchema = z.object({
  type: z.literal(WorkerMessageKind.StreamEnd),
  videoId: z.string(),
  streamType: z.string(),
  totalChunks: z.number()
});

const completeSchema = z.object({
  type: z.literal(WorkerMessageKind.Complete),
  videoId: z.string(),
  streamEnd: sharedPayloadSchema,
  videoBuffer: z.instanceof(ArrayBuffer).nullable(),
  audioBuffers: z.array(z.instanceof(ArrayBuffer).nullable())
});

const needsDirectUrlSchema = z.object({
  type: z.literal(WorkerMessageKind.NeedsDirectUrl),
  videoId: z.string(),
  tabId: z.number(),
  request: sharedPayloadSchema
});

const needsFallbackSchema = needsDirectUrlSchema.extend({
  type: z.literal(WorkerMessageKind.NeedsFallback)
});

const discardStreamsSchema = z.object({
  type: z.literal(WorkerMessageKind.DiscardStreams),
  videoId: z.string()
});

const errorSchema = z.object({
  type: z.literal(WorkerMessageKind.Error),
  videoId: z.string(),
  tabId: z.number(),
  error: z.string()
});

export type WorkerMessage =
  | z.infer<typeof chunkSchema>
  | z.infer<typeof streamEndSchema>
  | Prettify<z.infer<typeof completeSchema> & { streamEnd: ProcessStreamEndData }>
  | Prettify<z.infer<typeof needsDirectUrlSchema> & { request: DownloadRequest }>
  | Prettify<z.infer<typeof needsFallbackSchema> & { request: DownloadRequest }>
  | z.infer<typeof discardStreamsSchema>
  | z.infer<typeof errorSchema>;

export const isWorkerMessage = createShapeGuard<WorkerMessage>(
  z.discriminatedUnion("type", [
    chunkSchema,
    streamEndSchema,
    completeSchema,
    needsDirectUrlSchema,
    needsFallbackSchema,
    discardStreamsSchema,
    errorSchema
  ])
);

const startCommandSchema = z.object({
  type: z.literal(FrameCommandKind.Start),
  request: sharedPayloadSchema,
  tabId: z.number(),
  enrichedMetadata: z.looseObject({}).nullish()
});

const cancelCommandSchema = z.object({
  type: z.literal(FrameCommandKind.Cancel)
});

export type FrameCommand =
  | Prettify<Omit<z.infer<typeof startCommandSchema>, "request" | "enrichedMetadata"> & {
    request: DownloadRequest;
    enrichedMetadata: VideoMetadata | null;
  }>
  | z.infer<typeof cancelCommandSchema>;

export const isFrameCommand = createShapeGuard<FrameCommand>(
  z.discriminatedUnion("type", [startCommandSchema, cancelCommandSchema])
);
