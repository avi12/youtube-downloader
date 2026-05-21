export interface YtdlMediaCapture {
  videoChunks: Uint8Array[];
  audioChunks: Uint8Array[];
  videoMimeType: string;
  audioMimeType: string;
  videoTotalBytes: number;
  audioTotalBytes: number;
}

export interface YtdlCaptureState {
  activeVideoId: string;
  pendingChunks: Array<{
    mimeType: string;
    data: Uint8Array;
  }>;
  capturedMedia: Map<string, YtdlMediaCapture>;
  sourceBufferMimeTypes: WeakMap<SourceBuffer, string>;
  addChunkToCapture: (chunkInfo: {
    capture: YtdlMediaCapture;
    mimeType: string;
    chunk: Uint8Array;
  }) => void;
}

declare global {
  interface Window {
    __ytdlCapture: YtdlCaptureState;
  }
}
