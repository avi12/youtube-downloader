import type { YtdlCaptureState } from "@/types";

const MOVIE_PLAYER_ELEMENT_ID = "movie_player";
const AD_PLAYING_CLASS = "ytp-ad-playing";
const MIME_PREFIX_VIDEO = "video";
const MIME_PREFIX_AUDIO = "audio";

export function patchIframeMediaVolume() {
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

export function patchSourceBuffer(captureState: YtdlCaptureState) {
  const { sourceBufferMimeTypes, capturedMedia, pendingChunks, addChunkToCapture } = captureState;

  const originalAddSourceBuffer = MediaSource.prototype.addSourceBuffer;
  MediaSource.prototype.addSourceBuffer = function (mimeType) {
    const sourceBuffer = originalAddSourceBuffer.call(this, mimeType);
    const isMediaMimeType = mimeType.startsWith(MIME_PREFIX_VIDEO) || mimeType.startsWith(MIME_PREFIX_AUDIO);
    if (isMediaMimeType) {
      sourceBufferMimeTypes.set(sourceBuffer, mimeType);
    }

    return sourceBuffer;
  };

  function isAdPlaying() {
    return document.getElementById(MOVIE_PLAYER_ELEMENT_ID)?.classList.contains(AD_PLAYING_CLASS) ?? false;
  }

  const originalAppendBuffer = SourceBuffer.prototype.appendBuffer;
  SourceBuffer.prototype.appendBuffer = function (data) {
    const mimeType = sourceBufferMimeTypes.get(this);
    if (mimeType && !isAdPlaying()) {
      const chunk = data instanceof ArrayBuffer
        ? new Uint8Array(data)
        : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      const { activeVideoId } = captureState;
      const isCaptureMissing = !activeVideoId || !capturedMedia.has(activeVideoId);
      if (isCaptureMissing) {
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
