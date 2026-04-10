import { MessageType } from "@/lib/messaging";
import { uint8ToBase64 } from "@/lib/utils";

const TRANSFER_CHUNK_SIZE = 1024 * 1024;
const OFFSCREEN_PORT_NAME = "ytdl-offscreen";

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

export function sendToOffscreen(type: MessageType, data: Record<string, unknown>) {
  getOffscreenPort().postMessage({ type, data });
}

export async function sendStreamChunksToOffscreen(
  videoId: string,
  streamType: string,
  data: Uint8Array,
  tabId: number
) {
  const port = getOffscreenPort();
  const totalChunks = Math.ceil(data.byteLength / TRANSFER_CHUNK_SIZE);

  for (let iChunk = 0; iChunk < totalChunks; iChunk++) {
    const start = iChunk * TRANSFER_CHUNK_SIZE;
    const chunk = data.subarray(start, start + TRANSFER_CHUNK_SIZE);
    port.postMessage({
      type: MessageType.ProcessStreamChunk,
      data: {
        videoId,
        streamType,
        iChunk,
        totalChunks,
        chunkBase64: uint8ToBase64(chunk),
        tabId
      }
    });
  }
}

export { OFFSCREEN_PORT_NAME };
