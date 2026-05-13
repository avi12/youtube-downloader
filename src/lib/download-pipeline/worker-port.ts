import type { EmbedMetadataJob, MuxVideoAudioJob, TranscodeAudioJob, TranscodeFileJob } from "./mux-worker-types";
import { WorkerMessageType } from "./mux-worker-types";
import type { ProgressType } from "@/types";

// ---------------------------------------------------------------------------
// Protocol maps (analogous to OffscreenProtocolMap)
// ---------------------------------------------------------------------------

type WorkerCommandMap = {
  [WorkerMessageType.MuxVideoAudio]: { job: MuxVideoAudioJob };
  [WorkerMessageType.EmbedMetadata]: { job: EmbedMetadataJob };
  [WorkerMessageType.TranscodeAudio]: { job: TranscodeAudioJob };
  [WorkerMessageType.TranscodeFile]: { job: TranscodeFileJob };
};

type WorkerDataResponseMap = {
  [WorkerMessageType.Result]: { data: ArrayBuffer | null };
  [WorkerMessageType.Error]: { message: string };
  [WorkerMessageType.Progress]: {
    videoId: string;
    progress: number;
    progressType: ProgressType;
    tabId: number;
  };
};

type WorkerCommandType = keyof WorkerCommandMap;
type WorkerDataResponseType = keyof WorkerDataResponseMap;

type WorkerCommand = {
  [T in WorkerCommandType]: { type: T } & WorkerCommandMap[T];
}[WorkerCommandType];

type WorkerResponse =
  | { type: WorkerMessageType.Ready }
  | { [T in WorkerDataResponseType]: { type: T } & WorkerDataResponseMap[T]; }[WorkerDataResponseType];

type ResponseHandler<T extends WorkerDataResponseType> = (data: WorkerDataResponseMap[T]) => void;
type ResponseHandlerMap = {
  [WorkerMessageType.Ready]?: () => void;
} & { [T in WorkerDataResponseType]?: ResponseHandler<T> };

type CommandHandler<T extends WorkerCommandType> = (data: WorkerCommandMap[T]) => void;
type CommandHandlerMap = { [T in WorkerCommandType]?: CommandHandler<T> };

// ---------------------------------------------------------------------------
// Host side (offscreen main thread)
// ---------------------------------------------------------------------------

export type HostWorkerPort = {
  send<T extends WorkerCommandType>(
    type: T,
    data: WorkerCommandMap[T],
    transfer?: Transferable[]
  ): void;
  onMessage(handlers: ResponseHandlerMap): void;
  port: MessagePort;
};

export function createHostWorkerPort() {
  const { port1, port2 } = new MessageChannel();
  port1.start();

  let responseHandlers: ResponseHandlerMap = {};

  port1.onmessage = function onPortMessage(e: MessageEvent<WorkerResponse>) {
    const message = e.data;
    switch (message.type) {
      case WorkerMessageType.Ready:
        responseHandlers[WorkerMessageType.Ready]?.();
        break;
      case WorkerMessageType.Result:
        responseHandlers[WorkerMessageType.Result]?.({ data: message.data });
        break;
      case WorkerMessageType.Error:
        responseHandlers[WorkerMessageType.Error]?.({ message: message.message });
        break;
      case WorkerMessageType.Progress:
        responseHandlers[WorkerMessageType.Progress]?.({
          videoId: message.videoId,
          progress: message.progress,
          progressType: message.progressType,
          tabId: message.tabId
        });
        break;
    }
  };

  return {
    send<T extends WorkerCommandType>(type: T, data: WorkerCommandMap[T], transfer: Transferable[] = []) {
      port1.postMessage({
        type,
        ...data
      }, transfer);
    },
    onMessage(handlers: ResponseHandlerMap) {
      responseHandlers = handlers;
    },
    port: port2
  };
}

// ---------------------------------------------------------------------------
// Worker side
// ---------------------------------------------------------------------------

export type WorkerPortReceiver = {
  sendReady(): void;
  send<T extends WorkerDataResponseType>(
    type: T,
    data: WorkerDataResponseMap[T],
    transfer?: Transferable[]
  ): void;
  onMessage(handlers: CommandHandlerMap): void;
};

export function createWorkerPortReceiver(port: MessagePort) {
  port.start();

  let commandHandlers: CommandHandlerMap = {};

  port.onmessage = function onPortMessage(e: MessageEvent<WorkerCommand>) {
    const message = e.data;
    switch (message.type) {
      case WorkerMessageType.MuxVideoAudio:
        commandHandlers[WorkerMessageType.MuxVideoAudio]?.({ job: message.job });
        break;
      case WorkerMessageType.EmbedMetadata:
        commandHandlers[WorkerMessageType.EmbedMetadata]?.({ job: message.job });
        break;
      case WorkerMessageType.TranscodeAudio:
        commandHandlers[WorkerMessageType.TranscodeAudio]?.({ job: message.job });
        break;
      case WorkerMessageType.TranscodeFile:
        commandHandlers[WorkerMessageType.TranscodeFile]?.({ job: message.job });
        break;
    }
  };

  return {
    sendReady() {
      port.postMessage({ type: WorkerMessageType.Ready });
    },
    send<T extends WorkerDataResponseType>(type: T, data: WorkerDataResponseMap[T], transfer: Transferable[] = []) {
      port.postMessage({
        type,
        ...data
      }, transfer);
    },
    onMessage(handlers: CommandHandlerMap) {
      commandHandlers = handlers;
    }
  };
}
