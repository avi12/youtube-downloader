import type { EmbedMetadataJob, MuxVideoAudioJob, TranscodeAudioJob, TranscodeFileJob } from "./mux-worker-types";
import { WorkerMessageType } from "./mux-worker-types";
import type { ProgressType } from "@/types";

export type WorkerCommandMap = {
  [WorkerMessageType.MuxVideoAudio]: { job: MuxVideoAudioJob };
  [WorkerMessageType.EmbedMetadata]: { job: EmbedMetadataJob };
  [WorkerMessageType.TranscodeAudio]: { job: TranscodeAudioJob };
  [WorkerMessageType.TranscodeFile]: { job: TranscodeFileJob };
};

export type WorkerDataResponseMap = {
  [WorkerMessageType.Result]: { data: ArrayBuffer | null };
  [WorkerMessageType.ResultFile]: { data: File };
  [WorkerMessageType.Error]: { message: string };
  [WorkerMessageType.Progress]: {
    videoId: string;
    progress: number;
    progressType: ProgressType;
    tabId: number;
  };
};

export type WorkerCommandType = keyof WorkerCommandMap;
export type WorkerDataResponseType = keyof WorkerDataResponseMap;

export type WorkerCommand = {
  [T in WorkerCommandType]: { type: T } & WorkerCommandMap[T];
}[WorkerCommandType];

export type WorkerResponse =
  | { type: WorkerMessageType.Ready }
  | { [T in WorkerDataResponseType]: { type: T } & WorkerDataResponseMap[T]; }[WorkerDataResponseType];

export type ResponseHandler<T extends WorkerDataResponseType> = (data: WorkerDataResponseMap[T]) => void;
export type ResponseHandlerMap = {
  [WorkerMessageType.Ready]?: () => void;
} & { [T in WorkerDataResponseType]?: ResponseHandler<T> };

export type CommandHandler<T extends WorkerCommandType> = (data: WorkerCommandMap[T]) => void;
export type CommandHandlerMap = { [T in WorkerCommandType]?: CommandHandler<T> };
