/**
 * Media capture via SourceBuffer interception.
 *
 * Monkey-patches SourceBuffer.prototype.appendBuffer to capture the media data
 * that YouTube's player feeds to the Media Source Extensions API. This data is
 * already in valid fragmented MP4 or WebM container format, ready for FFmpeg.
 */

const capturedBuffers = new Map<string, {
  videoChunks: Uint8Array[];
  audioChunks: Uint8Array[];
  videoMimeType: string;
  audioMimeType: string;
  videoTotalBytes: number;
  audioTotalBytes: number;
}>();

let isPatched = false;

/**
 * Starts capturing SourceBuffer data for the current page.
 * Must be called from the MAIN world (has access to MediaSource).
 */
export function startCapture(videoId: string) {
  capturedBuffers.set(videoId, {
    videoChunks: [],
    audioChunks: [],
    videoMimeType: "video/mp4",
    audioMimeType: "audio/mp4",
    videoTotalBytes: 0,
    audioTotalBytes: 0
  });

  if (isPatched) {
    return;
  }

  isPatched = true;

  const originalAddSourceBuffer = MediaSource.prototype.addSourceBuffer;
  MediaSource.prototype.addSourceBuffer = function (mimeType: string) {
    const sourceBuffer = originalAddSourceBuffer.call(this, mimeType);
    const isVideo = mimeType.startsWith("video");
    const isAudio = mimeType.startsWith("audio");
    if (!isVideo && !isAudio) {
      return sourceBuffer;
    }

    const originalAppendBuffer = sourceBuffer.appendBuffer.bind(sourceBuffer);
    sourceBuffer.appendBuffer = function (data: BufferSource) {
      // Find the active capture (most recent videoId)
      const activeId = [...capturedBuffers.keys()].pop();
      if (activeId) {
        const capture = capturedBuffers.get(activeId)!;
        const chunk = data instanceof ArrayBuffer
          ? new Uint8Array(data)
          : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        if (isVideo) {
          capture.videoChunks.push(chunk.slice());
          capture.videoTotalBytes += chunk.byteLength;
          capture.videoMimeType = mimeType.split(";")[0];
        } else {
          capture.audioChunks.push(chunk.slice());
          capture.audioTotalBytes += chunk.byteLength;
          capture.audioMimeType = mimeType.split(";")[0];
        }
      }

      return originalAppendBuffer(data);
    };

    return sourceBuffer;
  };
}

/**
 * Returns the captured video and audio data for a videoId.
 * Assembles all chunks into single Uint8Arrays.
 */
export function getCapturedData(videoId: string) {
  const capture = capturedBuffers.get(videoId);
  if (!capture) {
    return null;
  }

  function assembleChunks(chunks: Uint8Array[], totalBytes: number) {
    if (chunks.length === 0) {
      return new Uint8Array(0);
    }

    const result = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.byteLength;
    }

    return result;
  }

  return {
    videoData: assembleChunks(capture.videoChunks, capture.videoTotalBytes),
    audioData: assembleChunks(capture.audioChunks, capture.audioTotalBytes),
    videoMimeType: capture.videoMimeType,
    audioMimeType: capture.audioMimeType
  };
}

/**
 * Clears captured data for a videoId.
 */
export function clearCapture(videoId: string) {
  capturedBuffers.delete(videoId);
}
