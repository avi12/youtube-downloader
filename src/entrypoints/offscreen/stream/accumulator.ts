import { base64ToUint8Array } from "./codec";
import { StreamType } from "@/types";

interface AudioStream {
  chunks: Map<number, Uint8Array>;
  totalChunks: number;
}

export interface SegmentData {
  videoChunks: Map<number, Uint8Array>;
  totalVideoChunks: number;
  audioChunks: Map<number, Uint8Array>;
  totalAudioChunks: number;
}

export interface StreamAccumulator {
  videoChunks: Map<number, Uint8Array>;
  totalVideoChunks: number;
  audioStreams: Map<string, AudioStream>;
  // iframe-scrub multi-segment downloads land here, keyed by segment index.
  // Each segment is a self-contained fMP4/WebM (init + its own fragments).
  segments: Map<number, SegmentData>;
}

export const STREAM_ACCUMULATORS = new Map<string, StreamAccumulator>();

const SEGMENT_STREAM_PATTERN = /^(video|audio)-seg-(\d+)$/;

function ensureSegment(accumulator: StreamAccumulator, index: number) {
  if (!accumulator.segments.has(index)) {
    accumulator.segments.set(index, {
      videoChunks: new Map(),
      totalVideoChunks: 0,
      audioChunks: new Map(),
      totalAudioChunks: 0
    });
  }

  return accumulator.segments.get(index);
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

  const accumulator = STREAM_ACCUMULATORS.get(videoId);
  if (!accumulator) {
    return;
  }

  const segMatch = streamType.match(SEGMENT_STREAM_PATTERN);
  if (segMatch) {
    const [, kind, indexStr] = segMatch;
    const segmentIndex = parseInt(indexStr, 10);
    const segment = ensureSegment(accumulator, segmentIndex);
    if (!segment) {
      return;
    }

    if (iChunk === -1) {
      if (kind === "video") {
        segment.totalVideoChunks = totalChunks;
      } else {
        segment.totalAudioChunks = totalChunks;
      }

      return;
    }

    const decodedSegChunk = base64ToUint8Array(chunkBase64);
    if (kind === "video") {
      segment.videoChunks.set(iChunk, decodedSegChunk);

      if (totalChunks > 0) {
        segment.totalVideoChunks = totalChunks;
      }
    } else {
      segment.audioChunks.set(iChunk, decodedSegChunk);

      if (totalChunks > 0) {
        segment.totalAudioChunks = totalChunks;
      }
    }

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
