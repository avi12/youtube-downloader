export function activateCaptureForVideoId(videoId: string) {
  const captureState = window.__ytdlCapture;
  if (!captureState) {
    return;
  }

  captureState.activeVideoId = videoId;

  const { capturedMedia, addChunkToCapture } = captureState;
  if (!capturedMedia.has(videoId)) {
    capturedMedia.set(videoId, {
      videoChunks: [],
      audioChunks: [],
      videoMimeType: "video/mp4",
      audioMimeType: "audio/mp4",
      videoTotalBytes: 0,
      audioTotalBytes: 0
    });
  }

  const { pendingChunks } = captureState;
  if (pendingChunks.length === 0) {
    return;
  }

  const capture = capturedMedia.get(videoId);
  if (!capture) {
    return;
  }

  for (const pending of pendingChunks) {
    addChunkToCapture({
      capture,
      mimeType: pending.mimeType,
      chunk: pending.data
    });
  }

  pendingChunks.length = 0;
}
