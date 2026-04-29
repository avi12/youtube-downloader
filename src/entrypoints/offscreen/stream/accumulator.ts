import type { SegmentData, StreamAccumulator } from "./accumulator-types";
import { base64ToUint8Array } from "./codec";
import { StreamType } from "@/types";

export type { SegmentData, StreamAccumulator } from "./accumulator-types";

export const STREAM_ACCUMULATORS = new Map<string, StreamAccumulator>();

const SEGMENT_STREAM_PATTERN = /^(video|audio)-seg-(\d+)$/;

function ensureSegment(accumulator: StreamAccumulator, index: number): SegmentData {
  if (!accumulator.segments.has(index)) {
    accumulator.segments.set(index, {
      videoChunks: new Map(),
      totalVideoChunks: 0,
      audioChunks: new Map(),
      totalAudioChunks: 0
    });
  }

  return accumulator.segments.get(index)!;
}

function handleSegmentChunk(
  segment: SegmentData,
  kind: string,
  iChunk: number,
  totalChunks: number,
  chunkBase64: string
) {
  if (iChunk === -1) {
    if (kind === "video") {
      segment.totalVideoChunks = totalChunks;
    } else {
      segment.totalAudioChunks = totalChunks;
    }

    return;
  }

  const decoded = base64ToUint8Array(chunkBase64);
  if (kind === "video") {
    segment.videoChunks.set(iChunk, decoded);

    if (totalChunks > 0) {
      segment.totalVideoChunks = totalChunks;
    }
  } else {
    segment.audioChunks.set(iChunk, decoded);

    if (totalChunks > 0) {
      segment.totalAudioChunks = totalChunks;
    }
  }
}

function handleAudioChunk(
  accumulator: StreamAccumulator,
  streamType: string,
  iChunk: number,
  totalChunks: number,
  decoded: Uint8Array
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

  audioStream.chunks.set(iChunk, decoded);

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
  const { videoId, streamType, iChunk, totalChunks, chunkBase64 } = data;
  if (!STREAM_ACCUMULATORS.has(videoId)) {
    STREAM_ACCUMULATORS.set(videoId, {
      videoChunks: new Map(),
      totalVideoChunks: 0,
      audioStreams: new Map(),
      segments: new Map()
    });
  }

  const accumulator = STREAM_ACCUMULATORS.get(videoId)!;
  const segMatch = streamType.match(SEGMENT_STREAM_PATTERN);
  if (segMatch) {
    const [, kind, indexStr] = segMatch;
    handleSegmentChunk(ensureSegment(accumulator, parseInt(indexStr, 10)), kind, iChunk, totalChunks, chunkBase64);
    return;
  }

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

  const decoded = base64ToUint8Array(chunkBase64);
  if (streamType === StreamType.Video) {
    accumulator.videoChunks.set(iChunk, decoded);

    if (totalChunks > 0) {
      accumulator.totalVideoChunks = totalChunks;
    }
  } else {
    handleAudioChunk(accumulator, streamType, iChunk, totalChunks, decoded);
  }
}
