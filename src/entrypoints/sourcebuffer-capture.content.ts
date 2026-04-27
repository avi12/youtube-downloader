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

    // YouTube uses separate SourceBuffers for ad and main-video streams (each
    // with its own ftyp/moov init). Stacking the ad buffer's bytes in front of
    // the main-video buffer's bytes produces a stream FFmpeg refuses to mux —
    // two init blocks, mismatched track ids. When a fresh SourceBuffer of the
    // same kind (video or audio) is created, the prior one's bytes belong to
    // an ad and must be dropped. Reset the corresponding side of the active
    // capture (and any pendingChunks of that kind) at that moment.
    const originalAddSourceBuffer = MediaSource.prototype.addSourceBuffer;
    MediaSource.prototype.addSourceBuffer = function (mimeType) {
      const sourceBuffer = originalAddSourceBuffer.call(this, mimeType);
      const kind = mimeType.startsWith("video")
        ? "video"
        : mimeType.startsWith("audio") ? "audio" : null;
      if (!kind) {
        return sourceBuffer;
      }

      sourceBufferMimeTypes.set(sourceBuffer, mimeType);

      const { activeVideoId, capturedMedia, pendingChunks } = captureState;
      const capture = activeVideoId ? capturedMedia.get(activeVideoId) : null;
      if (capture) {
        if (kind === "video") {
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

    // On a regular watch page the user might never click Download, so retaining
    // every appendBuffer chunk balloons memory and stalls the main thread on
    // every fragment. Init segments (ftyp+moov / EBML+Tracks) are <50KB and
    // are the only thing a later bind actually needs. Scrub iframes always end
    // up bound (scrub-self-drive activates capture in document_idle), but a
    // handful of media fragments may have already arrived between document_
    // start and that bind — those fragments are real media we want, so the
    // size cap is bypassed there.
    const PENDING_INIT_MAX_BYTES = 50_000;
    const isScrubFrame = /ytdlScrubMode=1/.test(location.search);
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
});
