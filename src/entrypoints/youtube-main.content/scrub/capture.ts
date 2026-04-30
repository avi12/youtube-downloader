// When an ad ran, pendingChunks contain a mix of the ad's own streams and
// real-video pre-fetches from the wrong time offset. Media fragments (large
// chunks) at the wrong position would corrupt the capture; init segments
// (ftyp+moov / EBML+Tracks, always ≤ 50 KB) are still required by FFmpeg.
// So when skipMediaFragments=true, keep only the init-sized chunks and discard
// the large media ones; let the post-seekTo fetch supply fresh media.
const PENDING_INIT_MAX_BYTES = 50_000;

export function bindCaptureToVideoId(videoId: string, skipMediaFragments = false) {
  const captureState = window.__ytdlCapture;
  if (!captureState) {
    return;
  }

  captureState.activeVideoId = videoId;

  if (!captureState.capturedMedia.has(videoId)) {
    captureState.capturedMedia.set(videoId, {
      videoChunks: [],
      audioChunks: [],
      videoMimeType: "video/mp4",
      audioMimeType: "audio/mp4",
      videoTotalBytes: 0,
      audioTotalBytes: 0
    });
  } else {
    const capture = captureState.capturedMedia.get(videoId);
    if (capture) {
      capture.videoChunks.length = 0;
      capture.audioChunks.length = 0;
      capture.videoTotalBytes = 0;
      capture.audioTotalBytes = 0;
    }
  }

  const capture = captureState.capturedMedia.get(videoId);
  if (capture) {
    for (const pending of captureState.pendingChunks) {
      if (skipMediaFragments && pending.data.byteLength > PENDING_INIT_MAX_BYTES) {
        continue;
      }

      captureState.addChunkToCapture({
        capture,
        mimeType: pending.mimeType,
        chunk: pending.data
      });
    }
  }

  captureState.pendingChunks.length = 0;
}

export function concatChunks(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}
