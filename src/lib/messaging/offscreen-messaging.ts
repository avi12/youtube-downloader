import {
  OffscreenMessageType,
  type HandlerMap,
  type OffscreenMessage,
  type OffscreenProtocolMap
} from "./offscreen-protocol";

export type { ProcessStreamChunkData, ProcessStreamEndData } from "./offscreen-protocol";
export { OffscreenMessageType };

const OFFSCREEN_PORT_NAME = "ytdl-offscreen";

function dispatchOffscreenMessage({ handlers, message }: {
  handlers: Partial<HandlerMap>;
  message: OffscreenMessage;
}) {
  switch (message.type) {
    case OffscreenMessageType.ProcessStreamChunk:
      handlers[OffscreenMessageType.ProcessStreamChunk]?.(message.data);
      break;
    case OffscreenMessageType.ProcessStreamEnd:
      handlers[OffscreenMessageType.ProcessStreamEnd]?.(message.data);
      break;
    case OffscreenMessageType.CancelProcessing:
      handlers[OffscreenMessageType.CancelProcessing]?.(message.data);
      break;
    case OffscreenMessageType.TranscodeRecentDownload:
      handlers[OffscreenMessageType.TranscodeRecentDownload]?.(message.data);
      break;
    case OffscreenMessageType.CreateDownloadIframe:
      handlers[OffscreenMessageType.CreateDownloadIframe]?.(message.data);
      break;
    case OffscreenMessageType.RemoveDownloadIframe:
      handlers[OffscreenMessageType.RemoveDownloadIframe]?.(message.data);
      break;
  }
}

let swSidePort: Browser.runtime.Port | null = null;

export function initOffscreenPortListener() {
  browser.runtime.onConnect.addListener(port => {
    if (port.name !== OFFSCREEN_PORT_NAME) {
      return;
    }

    swSidePort = port;
    port.onDisconnect.addListener(() => {
      swSidePort = null;
    });
  });
}

export function sendToOffscreen<T extends OffscreenMessageType>(
  type: T,
  data: OffscreenProtocolMap[T]
) {
  swSidePort?.postMessage({
    type,
    data
  });
}

export function listenForOffscreenMessages(handlers: HandlerMap) {
  function connect() {
    const port = browser.runtime.connect({ name: OFFSCREEN_PORT_NAME });
    port.onDisconnect.addListener(() => {
      connect();
    });
    port.onMessage.addListener((message: OffscreenMessage) => {
      dispatchOffscreenMessage({
        handlers,
        message
      });
    });
  }

  connect();
}
