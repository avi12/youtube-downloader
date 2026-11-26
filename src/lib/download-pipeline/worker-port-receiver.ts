import { WorkerMessageType } from "./mux-worker-types";
import { INVALID_WORKER_COMMAND_MESSAGE, isWorkerCommand } from "./worker-port-types";
import type {
  CommandHandlerMap,
  WorkerDataResponseMap,
  WorkerDataResponseType
} from "./worker-port-types";

export interface WorkerPortReceiver {
  sendReady(): void;
  send<T extends WorkerDataResponseType>(
    type: T,
    data: WorkerDataResponseMap[T],
    transfer?: Transferable[]
  ): void;
  onMessage(handlers: CommandHandlerMap): void;
}

export function createWorkerPortReceiver(port: MessagePort) {
  port.start();

  let commandHandlers: CommandHandlerMap = {};

  port.onmessage = function onPortMessage(event: MessageEvent<unknown>) {
    const message = event.data;
    if (!isWorkerCommand(message)) {
      port.postMessage({
        type: WorkerMessageType.Error,
        message: INVALID_WORKER_COMMAND_MESSAGE
      });
      return;
    }

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
