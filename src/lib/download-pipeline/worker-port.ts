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

type WorkerResponseMap = {
  [WorkerMessageType.Ready]: Record<string, never>;
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
type WorkerResponseType = keyof WorkerResponseMap;

type WorkerCommand = {
  [T in WorkerCommandType]: { type: T } & WorkerCommandMap[T];
}[WorkerCommandType];

type WorkerResponse = {
  [T in WorkerResponseType]: { type: T } & WorkerResponseMap[T];
}[WorkerResponseType];

type ResponseHandler<T extends WorkerResponseType> = (data: WorkerResponseMap[T]) => void;
type ResponseHandlerMap = { [T in WorkerResponseType]?: ResponseHandler<T> };

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

export function createHostWorkerPort(): HostWorkerPort {
  const { port1, port2 } = new MessageChannel();
  port1.start();

  let responseHandlers: ResponseHandlerMap = {};

  port1.onmessage = function onPortMessage(e: MessageEvent<WorkerResponse>) {
    const msg = e.data;
    switch (msg.type) {
      case WorkerMessageType.Ready:
        responseHandlers[WorkerMessageType.Ready]?.({});
        break;
      case WorkerMessageType.Result:
        responseHandlers[WorkerMessageType.Result]?.({ data: msg.data });
        break;
      case WorkerMessageType.Error:
        responseHandlers[WorkerMessageType.Error]?.({ message: msg.message });
        break;
      case WorkerMessageType.Progress:
        responseHandlers[WorkerMessageType.Progress]?.({
          videoId: msg.videoId,
          progress: msg.progress,
          progressType: msg.progressType,
          tabId: msg.tabId
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
  send<T extends WorkerResponseType>(
    type: T,
    data: WorkerResponseMap[T],
    transfer?: Transferable[]
  ): void;
  onMessage(handlers: CommandHandlerMap): void;
};

export function createWorkerPortReceiver(port: MessagePort): WorkerPortReceiver {
  port.start();

  let commandHandlers: CommandHandlerMap = {};

  port.onmessage = function onPortMessage(e: MessageEvent<WorkerCommand>) {
    const msg = e.data;
    switch (msg.type) {
      case WorkerMessageType.MuxVideoAudio:
        commandHandlers[WorkerMessageType.MuxVideoAudio]?.({ job: msg.job });
        break;
      case WorkerMessageType.EmbedMetadata:
        commandHandlers[WorkerMessageType.EmbedMetadata]?.({ job: msg.job });
        break;
      case WorkerMessageType.TranscodeAudio:
        commandHandlers[WorkerMessageType.TranscodeAudio]?.({ job: msg.job });
        break;
      case WorkerMessageType.TranscodeFile:
        commandHandlers[WorkerMessageType.TranscodeFile]?.({ job: msg.job });
        break;
    }
  };

  return {
    send<T extends WorkerResponseType>(type: T, data: WorkerResponseMap[T], transfer: Transferable[] = []) {
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
