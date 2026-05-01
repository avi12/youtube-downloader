import { crossWorldMessenger, CrossWorldMessage } from "@/lib/messaging/cross-world-messenger";
import type { VideoData, YtdlCaptureState } from "@/types";

const captureState: YtdlCaptureState = window.__ytdlCapture ?? {
  activeVideoId: "",
  pendingChunks: [],
  capturedMedia: new Map(),
  sourceBufferMimeTypes: new WeakMap(),
  addChunkToCapture() {}
};

export function activateCaptureForVideoId(videoId: string) {
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

export function activateIframeCaptureForVideo(videoData: VideoData) {
  activateCaptureForVideoId(videoData.videoId);

  const elPlayer = document.querySelector<HTMLElement & { stopVideo?: () => void }>("#movie_player");
  elPlayer?.stopVideo?.();
  void crossWorldMessenger.sendMessage(CrossWorldMessage.IframePlayerReady, { videoId: videoData.videoId });
}
