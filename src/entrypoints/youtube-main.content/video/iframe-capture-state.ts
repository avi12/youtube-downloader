import { crossWorldMessenger, CrossWorldMessage } from "@/lib/messaging/cross-world-messenger";
import type { VideoData, YtdlCaptureState } from "@/types";

const captureState: YtdlCaptureState = window.__ytdlCapture ?? {
  activeVideoId: "",
  pendingChunks: [],
  capturedMedia: new Map(),
  sourceBufferMimeTypes: new WeakMap(),
  addChunkToCapture() {}
};

export function activateIframeCaptureForVideo(videoData: VideoData) {
  captureState.activeVideoId = videoData.videoId;

  const { capturedMedia, addChunkToCapture } = captureState;
  if (!capturedMedia.has(captureState.activeVideoId)) {
    capturedMedia.set(captureState.activeVideoId, {
      videoChunks: [],
      audioChunks: [],
      videoMimeType: "video/mp4",
      audioMimeType: "audio/mp4",
      videoTotalBytes: 0,
      audioTotalBytes: 0
    });
  }

  const { pendingChunks } = captureState;
  if (pendingChunks.length > 0) {
    const capture = capturedMedia.get(captureState.activeVideoId);
    if (capture) {
      for (const pending of pendingChunks) {
        addChunkToCapture({
          capture,
          mimeType: pending.mimeType,
          chunk: pending.data
        });
      }

      pendingChunks.length = 0;
    }
  }

  const elPlayer = document.querySelector<HTMLElement & { stopVideo?: () => void }>("#movie_player");
  elPlayer?.stopVideo?.();
  void crossWorldMessenger.sendMessage(CrossWorldMessage.IframePlayerReady, { videoId: videoData.videoId });
}
