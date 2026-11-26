import {
  embedMetadataJobSchema,
  muxVideoAudioJobSchema,
  transcodeAudioJobSchema,
  transcodeFileJobSchema,
  WorkerMessageType
} from "./mux-worker-types";
import { z } from "@/lib/zod";
import { createGuard } from "@/lib/zod-guard";
import { ProgressType } from "@/types";

const workerCommandSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal(WorkerMessageType.MuxVideoAudio),
    job: muxVideoAudioJobSchema
  }),
  z.object({
    type: z.literal(WorkerMessageType.EmbedMetadata),
    job: embedMetadataJobSchema
  }),
  z.object({
    type: z.literal(WorkerMessageType.TranscodeAudio),
    job: transcodeAudioJobSchema
  }),
  z.object({
    type: z.literal(WorkerMessageType.TranscodeFile),
    job: transcodeFileJobSchema
  })
]);

const workerDataResponseSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal(WorkerMessageType.Result),
    data: z.instanceof(ArrayBuffer).nullable()
  }),
  z.object({
    type: z.literal(WorkerMessageType.ResultFile),
    data: z.instanceof(File)
  }),
  z.object({
    type: z.literal(WorkerMessageType.Error),
    message: z.string()
  }),
  z.object({
    type: z.literal(WorkerMessageType.Progress),
    videoId: z.string(),
    // FFmpeg progress is NaN when a timecode can't be read
    progress: z.union([z.number(), z.nan()]),
    progressType: z.enum(ProgressType),
    tabId: z.number()
  })
]);

const workerResponseSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal(WorkerMessageType.Ready) }),
  workerDataResponseSchema
]);

export const isWorkerCommand = createGuard(workerCommandSchema);
export const isWorkerResponse = createGuard(workerResponseSchema);

export const INVALID_WORKER_COMMAND_MESSAGE = "The mux worker got a malformed command";
export const INVALID_WORKER_RESPONSE_MESSAGE = "The mux worker sent a malformed response";

type WorkerCommand = z.infer<typeof workerCommandSchema>;
type WorkerDataResponse = z.infer<typeof workerDataResponseSchema>;

export type WorkerCommandMap = {
  [Command in WorkerCommand as Command["type"]]: Omit<Command, "type">;
};

export type WorkerDataResponseMap = {
  [Response in WorkerDataResponse as Response["type"]]: Omit<Response, "type">;
};

export type WorkerCommandType = keyof WorkerCommandMap;
export type WorkerDataResponseType = keyof WorkerDataResponseMap;

export type ResponseHandler<T extends WorkerDataResponseType> = (data: WorkerDataResponseMap[T]) => void;
export type ResponseHandlerMap = {
  [WorkerMessageType.Ready]?: () => void;
} & { [T in WorkerDataResponseType]?: ResponseHandler<T> };

export type CommandHandler<T extends WorkerCommandType> = (data: WorkerCommandMap[T]) => void;
export type CommandHandlerMap = { [T in WorkerCommandType]?: CommandHandler<T> };
