import { OPFSVideoWriter } from "./opfs-video-writer";
import type { ProcessStreamChunkData } from "@/lib/messaging/offscreen-messaging";
import { base64ToUint8Array } from "@/lib/utils/binary";
import { StreamType } from "@/types";

interface RawChunkData {
  videoId: string;
  streamType: string;
  iChunk: number;
  totalChunks: number;
  chunk: Uint8Array;
}

interface AudioStream {
  chunks: Map<number, Uint8Array>;
  totalChunks: number;
}

export interface StreamAccumulator {
  videoWriter: OPFSVideoWriter | null;
  totalVideoChunks: number;
  audioStreams: Map<string, AudioStream>;
}

export const STREAM_ACCUMULATORS = new Map<string, StreamAccumulator>();

function applyChunkToAccumulator({ videoId, streamType, iChunk, totalChunks, chunk }: RawChunkData) {
  const isAccumulatorMissing = !STREAM_ACCUMULATORS.has(videoId);
  if (isAccumulatorMissing) {
    STREAM_ACCUMULATORS.set(videoId, {
      videoWriter: null,
      totalVideoChunks: 0,
      audioStreams: new Map()
    });
  }

  const accumulator = STREAM_ACCUMULATORS.get(videoId);
  if (!accumulator) {
    return;
  }

  const isFinalMarker = iChunk === -1;
  if (isFinalMarker) {
    const isVideoStream = streamType === StreamType.Video;
    if (isVideoStream) {
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
    if (!accumulator.videoWriter) {
      accumulator.videoWriter = new OPFSVideoWriter(videoId);
    }

    accumulator.videoWriter.enqueueChunk(chunk);

    const hasTotalChunks = totalChunks > 0;
    if (hasTotalChunks) {
      accumulator.totalVideoChunks = totalChunks;
    }

    return;
  }

  const isAudioStreamMissing = !accumulator.audioStreams.has(streamType);
  if (isAudioStreamMissing) {
    accumulator.audioStreams.set(streamType, {
      chunks: new Map(),
      totalChunks: 0
    });
  }

  const audioStream = accumulator.audioStreams.get(streamType);
  if (!audioStream) {
    return;
  }

  audioStream.chunks.set(iChunk, chunk);

  const hasTotalChunks = totalChunks > 0;
  if (hasTotalChunks) {
    audioStream.totalChunks = totalChunks;
  }
}

export function handleProcessStreamChunk(data: ProcessStreamChunkData) {
  const { videoId, streamType, iChunk, totalChunks, chunkBase64 } = data;
  const isFinalMarker = iChunk === -1;
  applyChunkToAccumulator({
    videoId,
    streamType,
    iChunk,
    totalChunks,
    chunk: isFinalMarker ? new Uint8Array(0) : base64ToUint8Array(chunkBase64)
  });
}

export function handleProcessStreamChunkRaw(data: RawChunkData) {
  applyChunkToAccumulator(data);
}
