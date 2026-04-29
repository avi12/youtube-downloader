export interface AudioStream {
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
  segments: Map<number, SegmentData>;
}
