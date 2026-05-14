import { WorkerMessageType } from "./mux-worker-types";
import type {
  CommandHandlerMap,
  WorkerCommand,
  WorkerDataResponseMap,
  WorkerDataResponseType
} from "./worker-port-types";

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
