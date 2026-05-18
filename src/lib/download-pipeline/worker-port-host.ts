import { WorkerMessageType } from "./mux-worker-types";
import type { ResponseHandlerMap, WorkerCommandMap, WorkerCommandType, WorkerResponse } from "./worker-port-types";

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
      case WorkerMessageType.ResultFile:
        responseHandlers[WorkerMessageType.ResultFile]?.({ data: message.data });
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
