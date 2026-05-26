import { OffscreenMessageType, sendToOffscreen } from "@/lib/messaging/offscreen-messaging";
import { TRANSFER_CHUNK_SIZE, uint8ToBase64 } from "@/lib/utils/binary";
import { AUDIO_EXTRA_STREAM_PREFIX, StreamType } from "@/types";

type SendNetworkChunkToOffscreenParams = {
  videoId: string;
  streamType: string;
  iChunk: number;
  chunk: Uint8Array;
  tabId: number;
};
export function sendNetworkChunkToOffscreen(
  { videoId, streamType, iChunk, chunk, tabId }: SendNetworkChunkToOffscreenParams
) {
  sendToOffscreen({
    type: OffscreenMessageType.ProcessStreamChunk,
    data: {
      videoId,
      streamType,
      iChunk,
      totalChunks: 0,
      chunkBase64: uint8ToBase64(chunk),
      tabId
    }
  });
}

type SendStreamFinishedMarkerParams = {
  videoId: string;
  streamType: string;
  totalChunks: number;
  tabId: number;
};
export function sendStreamFinishedMarker({ videoId, streamType, totalChunks, tabId }: SendStreamFinishedMarkerParams) {
  sendToOffscreen({
    type: OffscreenMessageType.ProcessStreamChunk,
    data: {
      videoId,
      streamType,
      iChunk: -1,
      totalChunks,
      chunkBase64: "",
      tabId
    }
  });
}

const YIELD_EVERY_N_CHUNKS = 32;

type SendStreamChunksToOffscreenParams = {
  videoId: string;
  streamType: string;
  data: Uint8Array;
  tabId: number;
};
export async function sendStreamChunksToOffscreen(
  { videoId, streamType, data, tabId }: SendStreamChunksToOffscreenParams
) {
  const totalChunks = Math.ceil(data.byteLength / TRANSFER_CHUNK_SIZE);

  for (let iChunk = 0; iChunk < totalChunks; iChunk++) {
    const start = iChunk * TRANSFER_CHUNK_SIZE;
    const chunk = data.subarray(start, start + TRANSFER_CHUNK_SIZE);
    sendToOffscreen({
      type: OffscreenMessageType.ProcessStreamChunk,
      data: {
        videoId,
        streamType,
        iChunk,
        totalChunks,
        chunkBase64: uint8ToBase64(chunk),
        tabId
      }
    });

    const shouldYield = (iChunk + 1) % YIELD_EVERY_N_CHUNKS === 0;
    if (shouldYield) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }
}

type BuildTransferJobsParams = {
  videoData: Uint8Array | null;
  audioData: Uint8Array | null;
  additionalAudioTracks: { data: Uint8Array | null }[];
  videoId: string;
  tabId: number;
};
export function buildTransferJobs(
  { videoData, audioData, additionalAudioTracks, videoId, tabId }: BuildTransferJobsParams
) {
  const jobs: Promise<void>[] = [];
  if (videoData) {
    jobs.push(
      sendStreamChunksToOffscreen({
        videoId,
        streamType: StreamType.Video,
        data: videoData,
        tabId
      })
    );
  }

  if (audioData) {
    jobs.push(
      sendStreamChunksToOffscreen({
        videoId,
        streamType: StreamType.Audio,
        data: audioData,
        tabId
      })
    );
  }

  for (const [i, track] of additionalAudioTracks.entries()) {
    if (track.data) {
      jobs.push(
        sendStreamChunksToOffscreen({
          videoId,
          streamType: `${AUDIO_EXTRA_STREAM_PREFIX}-${i}`,
          data: track.data,
          tabId
        })
      );
    }
  }

  return jobs;
}
