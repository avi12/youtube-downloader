// Must run at document_start because YouTube creates SourceBuffers before document_idle;
// patching later means sourceBufferMimeTypes is empty and appendBuffer captures nothing.
import type { YtdlCaptureState, YtdlMediaCapture } from "@/types";

export default defineContentScript({
  matches: ["https://www.youtube.com/*"],
  world: "MAIN",
  runAt: "document_start",
  allFrames: true,
  main() {
    if (self !== top && !/ytdl=1/.test(location.search)) {
      return;
    }

    if (self !== top) {
      const mediaProto = HTMLMediaElement.prototype;

      const mutedDesc = Object.getOwnPropertyDescriptor(mediaProto, "muted");
      if (mutedDesc?.set) {
        const originalMutedSet = mutedDesc.set;
        Object.defineProperty(mediaProto, "muted", {
          ...mutedDesc,
          set(this: HTMLMediaElement) {
            originalMutedSet.call(this, true);
          }
        });
      }

      const volumeDesc = Object.getOwnPropertyDescriptor(mediaProto, "volume");
      if (volumeDesc?.set) {
        const originalVolumeSet = volumeDesc.set;
        Object.defineProperty(mediaProto, "volume", {
          ...volumeDesc,
          set(this: HTMLMediaElement) {
            originalVolumeSet.call(this, 0);
          }
        });
      }
    }

    const sourceBufferMimeTypes = new WeakMap<SourceBuffer, string>();

    function addChunkToCapture({ capture, mimeType, chunk }: {
      capture: YtdlMediaCapture;
      mimeType: string;
      chunk: Uint8Array;
    }) {
      if (mimeType.startsWith("video")) {
        capture.videoChunks.push(chunk.slice());
        capture.videoTotalBytes += chunk.byteLength;
        capture.videoMimeType = mimeType.split(";")[0];
      } else {
        capture.audioChunks.push(chunk.slice());
        capture.audioTotalBytes += chunk.byteLength;
        capture.audioMimeType = mimeType.split(";")[0];
      }
    }

    const captureState: YtdlCaptureState = {
      activeVideoId: "",
      pendingChunks: [],
      capturedMedia: new Map(),
      sourceBufferMimeTypes,
      addChunkToCapture
    };

    window.__ytdlCapture = captureState;

    const originalAddSourceBuffer = MediaSource.prototype.addSourceBuffer;
    MediaSource.prototype.addSourceBuffer = function (mimeType) {
      const sourceBuffer = originalAddSourceBuffer.call(this, mimeType);
      if (mimeType.startsWith("video") || mimeType.startsWith("audio")) {
        sourceBufferMimeTypes.set(sourceBuffer, mimeType);
      }

      return sourceBuffer;
    };

    const originalAppendBuffer = SourceBuffer.prototype.appendBuffer;
    SourceBuffer.prototype.appendBuffer = function (data) {
      const mimeType = sourceBufferMimeTypes.get(this);
      if (mimeType) {
        const chunk = data instanceof ArrayBuffer
          ? new Uint8Array(data)
          : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        const { activeVideoId, capturedMedia, pendingChunks } = captureState;
        if (!activeVideoId || !capturedMedia.has(activeVideoId)) {
          pendingChunks.push({
            mimeType,
            data: chunk.slice()
          });
        } else {
          const capture = capturedMedia.get(activeVideoId);
          if (capture) {
            addChunkToCapture({
              capture,
              mimeType,
              chunk
            });
          }
        }
      }

      return originalAppendBuffer.call(this, data);
    };
  }
});
