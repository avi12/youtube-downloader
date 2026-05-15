import { injectSegmentedDownloadButton } from "../watch-button/watch-button";
import { generatePoTokenIfNeeded, readYtcfg, videoDataCache } from "./video-data";
import { buildVideoData } from "./youtube-api";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";
import { videoDataStore } from "@/lib/ui/synced-stores.svelte";
import { getMoviePlayer } from "@/lib/youtube/movie-player";
import { type PlayerResponse, type YtdlCaptureState } from "@/types";

const captureState: YtdlCaptureState = window.__ytdlCapture ?? {
  activeVideoId: "",
  pendingChunks: [],
  capturedMedia: new Map(),
  sourceBufferMimeTypes: new WeakMap(),
  addChunkToCapture() {}
};

function flushPendingChunks() {
  const { capturedMedia, addChunkToCapture, pendingChunks, activeVideoId } = captureState;
  if (pendingChunks.length === 0) {
    return;
  }

  const capture = capturedMedia.get(activeVideoId);
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

  console.log(`[ytdl:capture] Flushed ${pendingChunks.length} pending chunks (init segments)`);
  pendingChunks.length = 0;
}

export async function buildAndDispatchVideoData({ playerResponse }: {
  playerResponse: PlayerResponse;
}) {
  const { clientVersion, clientName } = readYtcfg();
  const videoData = buildVideoData({
    playerResponse,
    clientVersion,
    clientName
  });

  videoDataCache.set(videoData.videoId, videoData);
  videoDataStore.set(videoData.videoId, videoData);
  void crossWorldMessenger.sendMessage(CrossWorldMessage.VideoData, videoData);

  captureState.activeVideoId = videoData.videoId;

  const isCaptureMapMissing = !captureState.capturedMedia.has(captureState.activeVideoId);
  if (isCaptureMapMissing) {
    captureState.capturedMedia.set(captureState.activeVideoId, {
      videoChunks: [],
      audioChunks: [],
      videoMimeType: "video/mp4",
      audioMimeType: "audio/mp4",
      videoTotalBytes: 0,
      audioTotalBytes: 0
    });
  }

  flushPendingChunks();

  if (self !== top) {
    getMoviePlayer()?.stopVideo?.();
    await generatePoTokenIfNeeded(videoData);
    void crossWorldMessenger.sendMessage(CrossWorldMessage.IframePlayerReady, { videoId: videoData.videoId });
    return;
  }

  if (location.pathname === "/watch") {
    await injectSegmentedDownloadButton(videoData);
  }
}

const PLAYER_RESPONSE_POLL_ATTEMPTS = 20;
const PLAYER_RESPONSE_POLL_INTERVAL_MS = 250;

export async function extractAndDispatchVideoData() {
  if (!location.pathname.startsWith("/watch")) {
    return;
  }

  for (let attempt = 0; attempt < PLAYER_RESPONSE_POLL_ATTEMPTS; attempt++) {
    const playerResponse = window.ytInitialPlayerResponse ?? null;
    const isReady = playerResponse?.videoDetails?.videoId
      && playerResponse.playabilityStatus?.status !== "UNPLAYABLE";
    if (isReady) {
      await buildAndDispatchVideoData({ playerResponse });
      return;
    }

    await new Promise(resolve => setTimeout(resolve, PLAYER_RESPONSE_POLL_INTERVAL_MS));
  }
}
