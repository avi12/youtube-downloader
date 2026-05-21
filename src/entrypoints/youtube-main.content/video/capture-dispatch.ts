import { injectSegmentedDownloadButton } from "../watch-button/watch-button";
import { generatePoTokenIfNeeded, readYtcfg, videoDataCache } from "./video-data";
import { buildVideoData } from "./youtube-api";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";
import { videoDataStore } from "@/lib/ui/synced-stores.svelte";
import { getMoviePlayer } from "@/lib/youtube/movie-player";
import { type PlayerResponse, type YtdlCaptureState } from "@/types";
import { PlayabilityStatus } from "@/types/youtube";

const WATCH_PATHNAME = "/watch";
const DEFAULT_VIDEO_MIME_TYPE = "video/mp4";
const DEFAULT_AUDIO_MIME_TYPE = "audio/mp4";

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

function readInitialDataTitle(videoId: string) {
  const data = window.ytInitialData;
  const isMatchingVideoId = data?.currentVideoEndpoint?.watchEndpoint?.videoId === videoId;
  if (!isMatchingVideoId) {
    return "";
  }

  return data.contents
    ?.twoColumnWatchNextResults?.results?.results?.contents?.[0]
    ?.videoPrimaryInfoRenderer?.title?.runs?.[0]?.text ?? "";
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

  const isTopFrameOnWatchPage = self === top && location.pathname === WATCH_PATHNAME;
  if (isTopFrameOnWatchPage) {
    const initialDataTitle = readInitialDataTitle(videoData.videoId);
    if (initialDataTitle) {
      videoData.title = initialDataTitle;
    }
  }

  videoDataCache.set(videoData.videoId, videoData);
  videoDataStore.set(videoData.videoId, videoData);
  void crossWorldMessenger.sendMessage(CrossWorldMessage.VideoData, videoData);

  captureState.activeVideoId = videoData.videoId;

  const isCaptureMapMissing = !captureState.capturedMedia.has(captureState.activeVideoId);
  if (isCaptureMapMissing) {
    captureState.capturedMedia.set(captureState.activeVideoId, {
      videoChunks: [],
      audioChunks: [],
      videoMimeType: DEFAULT_VIDEO_MIME_TYPE,
      audioMimeType: DEFAULT_AUDIO_MIME_TYPE,
      videoTotalBytes: 0,
      audioTotalBytes: 0
    });
  }

  flushPendingChunks();

  const isIframe = self !== top;
  if (isIframe) {
    getMoviePlayer()?.stopVideo?.();
    void crossWorldMessenger.sendMessage(CrossWorldMessage.IframePlayerReady, { videoId: videoData.videoId });
    await generatePoTokenIfNeeded(videoData);
    return;
  }

  const isWatchPage = location.pathname === WATCH_PATHNAME;
  if (isWatchPage) {
    await injectSegmentedDownloadButton(videoData);
  }
}

const PLAYER_RESPONSE_POLL_ATTEMPTS = 20;
const PLAYER_RESPONSE_POLL_INTERVAL_MS = 250;

export async function extractAndDispatchVideoData() {
  const isOnWatchPage = location.pathname.startsWith(WATCH_PATHNAME);
  if (!isOnWatchPage) {
    return;
  }

  for (let attempt = 0; attempt < PLAYER_RESPONSE_POLL_ATTEMPTS; attempt++) {
    const playerResponse = window.ytInitialPlayerResponse ?? null;
    const isReady = !!playerResponse?.videoDetails?.videoId
      && playerResponse.playabilityStatus?.status !== PlayabilityStatus.Unplayable;
    if (isReady) {
      await buildAndDispatchVideoData({ playerResponse });
      return;
    }

    await new Promise(resolve => setTimeout(resolve, PLAYER_RESPONSE_POLL_INTERVAL_MS));
  }
}
