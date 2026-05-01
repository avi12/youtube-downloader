import { StreamType } from "@/types";
import type { YtdlCaptureState, YtdlMediaCapture } from "@/types";

const PENDING_INIT_MAX_BYTES = 50_000;

export function createCaptureState(sourceBufferMimeTypes: WeakMap<SourceBuffer, string>) {
  function addChunkToCapture({ capture, mimeType, chunk }: {
    capture: YtdlMediaCapture;
    mimeType: string;
    chunk: Uint8Array;
  }) {
    if (mimeType.startsWith(StreamType.Video)) {
      capture.videoChunks.push(chunk.slice());
      capture.videoTotalBytes += chunk.byteLength;
      capture.videoMimeType = mimeType.split(";")[0];
    } else {
      capture.audioChunks.push(chunk.slice());
      capture.audioTotalBytes += chunk.byteLength;
      capture.audioMimeType = mimeType.split(";")[0];
    }
  }

  return {
    activeVideoId: "",
    pendingChunks: [],
    capturedMedia: new Map(),
    sourceBufferMimeTypes,
    addChunkToCapture
  };
}

export function patchAddSourceBuffer(
  captureState: YtdlCaptureState,
  sourceBufferMimeTypes: WeakMap<SourceBuffer, string>
) {
  const originalAddSourceBuffer = MediaSource.prototype.addSourceBuffer;
  MediaSource.prototype.addSourceBuffer = function (mimeType) {
    const sourceBuffer = originalAddSourceBuffer.call(this, mimeType);
    let kind: StreamType | null = null;
    if (mimeType.startsWith(StreamType.Video)) {
      kind = StreamType.Video;
    } else if (mimeType.startsWith(StreamType.Audio)) {
      kind = StreamType.Audio;
    }

    if (!kind) {
      return sourceBuffer;
    }

    sourceBufferMimeTypes.set(sourceBuffer, mimeType);

    const { activeVideoId, capturedMedia, pendingChunks } = captureState;
    const capture = activeVideoId ? capturedMedia.get(activeVideoId) : null;
    if (capture) {
      if (kind === StreamType.Video) {
        capture.videoChunks.length = 0;
        capture.videoTotalBytes = 0;
      } else {
        capture.audioChunks.length = 0;
        capture.audioTotalBytes = 0;
      }
    }

    for (let i = pendingChunks.length - 1; i >= 0; i--) {
      if (pendingChunks[i]!.mimeType.startsWith(kind)) {
        pendingChunks.splice(i, 1);
      }
    }

    return sourceBuffer;
  };
}

export function patchAppendBuffer(
  captureState: YtdlCaptureState,
  sourceBufferMimeTypes: WeakMap<SourceBuffer, string>,
  isScrubFrame: boolean
) {
  const seenInitForBuffer = new WeakSet<SourceBuffer>();
  const originalAppendBuffer = SourceBuffer.prototype.appendBuffer;
  SourceBuffer.prototype.appendBuffer = function (data) {
    const mimeType = sourceBufferMimeTypes.get(this);
    if (mimeType) {
      const chunk = data instanceof ArrayBuffer
        ? new Uint8Array(data)
        : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      const { activeVideoId, capturedMedia, pendingChunks, addChunkToCapture } = captureState;
      if (activeVideoId && capturedMedia.has(activeVideoId)) {
        const capture = capturedMedia.get(activeVideoId);
        if (capture) {
          addChunkToCapture({
            capture,
            mimeType,
            chunk
          });
        }
      } else if (isScrubFrame) {
        pendingChunks.push({
          mimeType,
          data: chunk.slice()
        });
      } else if (!seenInitForBuffer.has(this) && chunk.byteLength <= PENDING_INIT_MAX_BYTES) {
        pendingChunks.push({
          mimeType,
          data: chunk.slice()
        });
        seenInitForBuffer.add(this);
      }
    }

    return originalAppendBuffer.call(this, data);
  };
}
