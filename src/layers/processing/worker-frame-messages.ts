import { processStreamEndSchema } from "@/lib/messaging/offscreen-messaging";
import { z } from "@/lib/zod";
import { createGuard } from "@/lib/zod-guard";
import { downloadRequestSchema } from "@/types/domain-types";
import { videoMetadataSchema } from "@/types/settings-types";

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
  streamEnd: processStreamEndSchema,
  videoBuffer: z.instanceof(ArrayBuffer).nullable(),
  audioBuffers: z.array(z.instanceof(ArrayBuffer).nullable())
});

const needsDirectUrlSchema = z.object({
  type: z.literal(WorkerMessageKind.NeedsDirectUrl),
  videoId: z.string(),
  tabId: z.number(),
  request: downloadRequestSchema
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

const workerMessageSchema = z.discriminatedUnion("type", [
  chunkSchema,
  streamEndSchema,
  completeSchema,
  needsDirectUrlSchema,
  needsFallbackSchema,
  discardStreamsSchema,
  errorSchema
]);

export type WorkerMessage = z.infer<typeof workerMessageSchema>;

export const isWorkerMessage = createGuard(workerMessageSchema);

const startCommandSchema = z.object({
  type: z.literal(FrameCommandKind.Start),
  request: downloadRequestSchema,
  tabId: z.number(),
  // Untagged beats not downloaded
  enrichedMetadata: videoMetadataSchema.nullable().catch(null)
});

const cancelCommandSchema = z.object({
  type: z.literal(FrameCommandKind.Cancel)
});

const frameCommandSchema = z.discriminatedUnion("type", [startCommandSchema, cancelCommandSchema]);

export type FrameCommand = z.infer<typeof frameCommandSchema>;

export const isFrameCommand = createGuard(frameCommandSchema);
