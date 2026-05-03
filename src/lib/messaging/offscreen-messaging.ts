import {
  type HandlerMap,
  type OffscreenMessage,
  OffscreenMessageType,
  type OffscreenProtocolMap
} from "./offscreen-protocol";
import { TRANSFER_CHUNK_SIZE } from "@/lib/utils/binary";

export { OffscreenMessageType };
export type { HandlerMap };

const OFFSCREEN_PORT_NAME = "ytdl-offscreen";
const YIELD_EVERY_N_CHUNKS = 32;

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
    case OffscreenMessageType.PipelineDownload:
      handlers[OffscreenMessageType.PipelineDownload]?.(message.data);
      break;
    case OffscreenMessageType.TranscodeRecentDownload:
      handlers[OffscreenMessageType.TranscodeRecentDownload]?.(message.data);
      break;
    case OffscreenMessageType.SpawnIframe:
      handlers[OffscreenMessageType.SpawnIframe]?.(message.data);
      break;
    case OffscreenMessageType.RemoveIframe:
      handlers[OffscreenMessageType.RemoveIframe]?.(message.data);
      break;
    case OffscreenMessageType.ForwardToIframe:
      handlers[OffscreenMessageType.ForwardToIframe]?.(message.data);
      break;
  }
}

let offscreenPort: Browser.runtime.Port | null = null;

function getOffscreenPort() {
  if (!offscreenPort) {
    offscreenPort = browser.runtime.connect({ name: OFFSCREEN_PORT_NAME });
    offscreenPort.onDisconnect.addListener(() => {
      offscreenPort = null;
    });
  }

  return offscreenPort;
}

export function sendToOffscreen<T extends OffscreenMessageType>(
  type: T,
  data: OffscreenProtocolMap[T]
) {
  getOffscreenPort().postMessage({
    type,
    data
  });
}

export async function sendBytesToOffscreen({ videoId, streamType, data, tabId }: {
  videoId: string;
  streamType: string;
  data: Uint8Array;
  tabId: number;
}) {
  const totalChunks = Math.ceil(data.byteLength / TRANSFER_CHUNK_SIZE);
  if (totalChunks === 0) {
    return;
  }

  for (let iChunk = 0; iChunk < totalChunks; iChunk++) {
    const start = iChunk * TRANSFER_CHUNK_SIZE;
    const slice = data.subarray(start, start + TRANSFER_CHUNK_SIZE);
    sendToOffscreen(OffscreenMessageType.ProcessStreamChunk, {
      videoId,
      streamType,
      iChunk,
      totalChunks,
      chunkBytes: slice,
      tabId
    });

    if ((iChunk + 1) % YIELD_EVERY_N_CHUNKS === 0) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }
}

export function listenForOffscreenMessages(handlers: HandlerMap) {
  browser.runtime.onConnect.addListener(port => {
    if (port.name !== OFFSCREEN_PORT_NAME) {
      return;
    }

    port.onMessage.addListener((message: OffscreenMessage) => {
      dispatchOffscreenMessage({
        handlers,
        message
      });
    });
  });
}
