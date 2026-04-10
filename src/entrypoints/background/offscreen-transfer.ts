import { OffscreenMessageType, sendToOffscreen } from "@/lib/offscreen-messaging";
import { uint8ToBase64 } from "@/lib/utils";

const TRANSFER_CHUNK_SIZE = 1024 * 1024;

export async function sendStreamChunksToOffscreen(
  videoId: string,
  streamType: string,
  data: Uint8Array,
  tabId: number
) {
  const totalChunks = Math.ceil(data.byteLength / TRANSFER_CHUNK_SIZE);

  for (let iChunk = 0; iChunk < totalChunks; iChunk++) {
    const start = iChunk * TRANSFER_CHUNK_SIZE;
    const chunk = data.subarray(start, start + TRANSFER_CHUNK_SIZE);
    sendToOffscreen(OffscreenMessageType.ProcessStreamChunk, {
      videoId,
      streamType,
      iChunk,
      totalChunks,
      chunkBase64: uint8ToBase64(chunk),
      tabId
    });
  }
}
