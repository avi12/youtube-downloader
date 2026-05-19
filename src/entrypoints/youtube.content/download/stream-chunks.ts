import { MessageType, sendMessage } from "@/lib/messaging/messaging";
import { TRANSFER_CHUNK_SIZE, uint8ToBase64 } from "@/lib/utils/binary";

type SendStreamChunksParams = {
  videoId: string;
  streamType: string;
  data: Uint8Array;
};
export async function sendStreamChunks({ videoId, streamType, data }: SendStreamChunksParams) {
  const totalChunks = Math.ceil(data.byteLength / TRANSFER_CHUNK_SIZE);

  await Promise.all(
    Array.from({ length: totalChunks }, (_, iChunk) => {
      const start = iChunk * TRANSFER_CHUNK_SIZE;
      const chunk = data.subarray(start, start + TRANSFER_CHUNK_SIZE);
      return sendMessage(MessageType.StreamChunk, {
        videoId,
        streamType,
        iChunk,
        totalChunks,
        chunkBase64: uint8ToBase64(chunk)
      });
    })
  );
}

const playlistContextByVideoId = new Map<string, {
  playlistId: string;
  playlistTitle: string;
  playlistTotalCount: number;
}>();

type SetPlaylistContextParams = {
  videoId: string;
  context: Parameters<typeof playlistContextByVideoId.set>[1];
};
export function setPlaylistContext({ videoId, context }: SetPlaylistContextParams) {
  playlistContextByVideoId.set(videoId, context);
}

export function popPlaylistContext(videoId: string) {
  const context = playlistContextByVideoId.get(videoId);
  playlistContextByVideoId.delete(videoId);
  return context;
}
