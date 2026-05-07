import { base64ToUint8Array } from "@/lib/utils/binary";
import { StreamType } from "@/types";

export interface AudioStream {
  chunks: Map<number, Uint8Array>;
  totalChunks: number;
}

export interface StreamAccumulator {
  videoChunks: Map<number, Uint8Array>;
  totalVideoChunks: number;
  audioStreams: Map<string, AudioStream>;
}

export const STREAM_ACCUMULATORS = new Map<string, StreamAccumulator>();

function handleAudioChunk(
  accumulator: StreamAccumulator,
  streamType: string,
  iChunk: number,
  totalChunks: number,
  chunkBytes: Uint8Array
) {
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

  audioStream.chunks.set(iChunk, chunkBytes);

  if (totalChunks > 0) {
    audioStream.totalChunks = totalChunks;
  }
}

export function handleProcessStreamChunk(data: {
  videoId: string;
  streamType: string;
  iChunk: number;
  totalChunks: number;
  chunkBase64: string;
  tabId: number;
}) {
  const { videoId, streamType, iChunk, totalChunks } = data;
  const chunkBytes = base64ToUint8Array(data.chunkBase64);
  if (!STREAM_ACCUMULATORS.has(videoId)) {
    STREAM_ACCUMULATORS.set(videoId, {
      videoChunks: new Map(),
      totalVideoChunks: 0,
      audioStreams: new Map()
    });
  }

  const accumulator = STREAM_ACCUMULATORS.get(videoId)!;
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

  if (streamType === StreamType.Video) {
    accumulator.videoChunks.set(iChunk, chunkBytes);

    if (totalChunks > 0) {
      accumulator.totalVideoChunks = totalChunks;
    }
  } else {
    handleAudioChunk(accumulator, streamType, iChunk, totalChunks, chunkBytes);
  }
}
