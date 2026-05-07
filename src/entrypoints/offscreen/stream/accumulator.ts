import { base64ToUint8Array } from "./codec";
import { StreamType } from "@/types";

interface AudioStream {
  chunks: Map<number, Uint8Array>;
  totalChunks: number;
}

export interface StreamAccumulator {
  videoChunks: Map<number, Uint8Array>;
  totalVideoChunks: number;
  audioStreams: Map<string, AudioStream>;
}

export const STREAM_ACCUMULATORS = new Map<string, StreamAccumulator>();

export function handleProcessStreamChunk(data: {
  videoId: string;
  streamType: string;
  iChunk: number;
  totalChunks: number;
  chunkBase64: string;
  tabId: number;
}) {
  const { videoId, streamType, iChunk, totalChunks, chunkBase64 } = data;
  if (!STREAM_ACCUMULATORS.has(videoId)) {
    STREAM_ACCUMULATORS.set(videoId, {
      videoChunks: new Map(),
      totalVideoChunks: 0,
      audioStreams: new Map()
    });
  }

  const accumulator = STREAM_ACCUMULATORS.get(videoId);
  if (!accumulator) {
    return;
  }

  // iChunk === -1 is a final marker that sets totalChunks for streaming SabrDownload
  // where total is unknown during transfer.
  if (iChunk === -1) {
    if (streamType === StreamType.Video) {
      accumulator.totalVideoChunks = totalChunks;
    } else {
      const audioStream = accumulator.audioStreams.get(streamType);
      if (audioStream) {
        audioStream.totalChunks = totalChunks;
      }
    }

    return;
  }

  const decodedChunk = base64ToUint8Array(chunkBase64);
  if (streamType === StreamType.Video) {
    accumulator.videoChunks.set(iChunk, decodedChunk);

    if (totalChunks > 0) {
      accumulator.totalVideoChunks = totalChunks;
    }
  } else {
    if (!accumulator.audioStreams.has(streamType)) {
      accumulator.audioStreams.set(streamType, {
        chunks: new Map(),
        totalChunks: 0
      });
    }

    const audioStream = accumulator.audioStreams.get(streamType);
    if (!audioStream) {
      return;
    }

    audioStream.chunks.set(iChunk, decodedChunk);

    if (totalChunks > 0) {
      audioStream.totalChunks = totalChunks;
    }
  }
}
