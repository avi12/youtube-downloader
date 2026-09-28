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
  await crossWorldMessenger.sendMessage(CrossWorldMessage.VideoData, videoData);

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
    await crossWorldMessenger.sendMessage(CrossWorldMessage.IframePlayerReady, { videoId: videoData.videoId });
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
const IFRAME_DOWNLOAD_PARAM = "ytdl";
const MAX_IFRAME_UNPLAYABLE_RELOADS = 5;
const IFRAME_RELOAD_COUNT_KEY = "__ytdlIframeUnplayableReloads";

function isInDownloadIframe() {
  const isNestedFrame = self !== top;
  if (!isNestedFrame) {
    return false;
  }

  return new URLSearchParams(location.search).get(IFRAME_DOWNLOAD_PARAM) === "1";
}

function readReloadCount() {
  const stored = Number(sessionStorage.getItem(IFRAME_RELOAD_COUNT_KEY));
  return Number.isFinite(stored) ? stored : 0;
}

function reloadUnplayableIframe() {
  const reloadCount = readReloadCount();
  const isExhausted = reloadCount >= MAX_IFRAME_UNPLAYABLE_RELOADS;
  if (isExhausted) {
    return false;
  }

  sessionStorage.setItem(IFRAME_RELOAD_COUNT_KEY, String(reloadCount + 1));
  console.warn(`[ytdl:iframe] Player response UNPLAYABLE; reloading iframe (${reloadCount + 1}/${MAX_IFRAME_UNPLAYABLE_RELOADS})`);
  location.reload();
  return true;
}

const PollOutcome = {
  Ready: "ready",
  RetriedAsync: "retried",
  Wait: "wait"
} as const;

type PollOutcome = (typeof PollOutcome)[keyof typeof PollOutcome];

async function tryDispatchOnce(isDownloadIframe: boolean): Promise<PollOutcome> {
  const playerResponse = window.ytInitialPlayerResponse ?? null;
  const hasVideoId = !!playerResponse?.videoDetails?.videoId;
  if (!hasVideoId) {
    return PollOutcome.Wait;
  }

  const isUnplayable = playerResponse.playabilityStatus?.status === PlayabilityStatus.Unplayable;
  if (isUnplayable && isDownloadIframe) {
    if (reloadUnplayableIframe()) {
      return PollOutcome.RetriedAsync;
    }

    // Reloads exhausted: the video is genuinely unplayable (removed/private), so
    // tell the background to surface the terminal "unavailable" state instead of
    // dispatching data for a video that can never be fetched.
    sessionStorage.removeItem(IFRAME_RELOAD_COUNT_KEY);
    const videoId = playerResponse.videoDetails?.videoId ?? "";
    await crossWorldMessenger.sendMessage(CrossWorldMessage.ReportMainDownloadFailed, {
      videoId,
      isUnavailable: true
    });
    return PollOutcome.Ready;
  }

  sessionStorage.removeItem(IFRAME_RELOAD_COUNT_KEY);
  await buildAndDispatchVideoData({ playerResponse });
  return PollOutcome.Ready;
}

export async function extractAndDispatchVideoData() {
  const isOnWatchPage = location.pathname.startsWith(WATCH_PATHNAME);
  if (!isOnWatchPage) {
    return;
  }

  const isDownloadIframe = isInDownloadIframe();
  for (let attempt = 0; attempt < PLAYER_RESPONSE_POLL_ATTEMPTS; attempt++) {
    const outcome = await tryDispatchOnce(isDownloadIframe);
    const isTerminal = outcome === PollOutcome.Ready || outcome === PollOutcome.RetriedAsync;
    if (isTerminal) {
      return;
    }

    await new Promise(resolve => setTimeout(resolve, PLAYER_RESPONSE_POLL_INTERVAL_MS));
  }
}
