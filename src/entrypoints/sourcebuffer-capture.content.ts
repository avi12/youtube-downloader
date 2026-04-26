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

    const isTopLevelScrubTab = self === top && /ytdlScrubMode=1/.test(location.search);
    if (self !== top || isTopLevelScrubTab) {
      const mediaProto = HTMLMediaElement.prototype;

      const mutedDescriptor = Object.getOwnPropertyDescriptor(mediaProto, "muted");
      if (mutedDescriptor?.set) {
        const originalMutedSet = mutedDescriptor.set;
        Object.defineProperty(mediaProto, "muted", {
          ...mutedDescriptor,
          set(this: HTMLMediaElement) {
            originalMutedSet.call(this, true);
          }
        });
      }

      const volumeDescriptor = Object.getOwnPropertyDescriptor(mediaProto, "volume");
      if (volumeDescriptor?.set) {
        const originalVolumeSet = volumeDescriptor.set;
        Object.defineProperty(mediaProto, "volume", {
          ...volumeDescriptor,
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

    // Init segments (ftyp+moov for fMP4, EBML+Tracks for WebM) are typically
    // a few KB; only those need to be retained pre-download so a later capture
    // bind has the codec headers. Media fragments are 100KB-1MB each and there
    // are dozens per minute of playback — copying them all into pendingChunks
    // would balloon memory and stall the main thread on every appendBuffer.
    const PENDING_INIT_MAX_BYTES = 50_000;
    const seenInitForBuffer = new WeakSet<SourceBuffer>();

    const originalAppendBuffer = SourceBuffer.prototype.appendBuffer;
    SourceBuffer.prototype.appendBuffer = function (data) {
      const mimeType = sourceBufferMimeTypes.get(this);
      if (mimeType) {
        const chunk = data instanceof ArrayBuffer
          ? new Uint8Array(data)
          : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        const { activeVideoId, capturedMedia, pendingChunks } = captureState;
        if (activeVideoId && capturedMedia.has(activeVideoId)) {
          const capture = capturedMedia.get(activeVideoId);
          if (capture) {
            addChunkToCapture({
              capture,
              mimeType,
              chunk
            });
          }
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
});
