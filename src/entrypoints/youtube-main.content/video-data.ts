import { setPoTokenCredentials } from "./credentials";
import { injectSegmentedDownloadButton } from "./watch-button";
import { buildVideoData } from "./youtube-api";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/cross-world-messenger";
import { generatePoToken } from "@/lib/po-token-generator";
import { sabrCredentials, videoDataStore } from "@/lib/synced-stores.svelte";
import { type PlayerResponse, type VideoData, type YtdlCaptureState } from "@/types";

declare const ytcfg: { get: (key: string) => unknown } | undefined;

export const videoDataCache = new Map<string, VideoData>();

// SourceBuffer capture state is managed by sourcebuffer-capture.content.ts
// which runs at document_start. We read/write it via window.__ytdlCapture.
// Fall back to a no-op stub if the capture script didn't initialize
// (e.g., on non-download pages where it returned early).
export const captureState: YtdlCaptureState = window.__ytdlCapture ?? {
  activeVideoId: "",
  pendingChunks: [],
  capturedMedia: new Map(),
  sourceBufferMimeTypes: new WeakMap(),
  addChunkToCapture() {}
};

export function readYtcfg() {
  const clientVersionRaw = ytcfg?.get("INNERTUBE_CLIENT_VERSION");
  const clientVersion = typeof clientVersionRaw === "string" ? clientVersionRaw : "";
  const clientNameRaw = ytcfg?.get("INNERTUBE_CONTEXT_CLIENT_NAME");
  const clientName = typeof clientNameRaw === "number" ? clientNameRaw : 1;
  return { clientVersion, clientName };
}

export function buildVideoMetadata(videoId: string) {
  const cached = videoDataCache.get(videoId);
  if (!cached) {
    return null;
  }

  const { playerResponse } = cached;
  const thumbnails = playerResponse.videoDetails?.thumbnail?.thumbnails ?? [];
  // Pick the largest thumbnail for cover art
  const thumbnailUrl = thumbnails.length > 0
    ? thumbnails[thumbnails.length - 1].url
    : undefined;

  return {
    title: cached.title,
    artist: playerResponse.videoDetails?.author ?? "",
    date: playerResponse.microformat?.playerMicroformatRenderer.publishDate,
    thumbnailUrl,
    isMusic: cached.isMusic
  };
}

export async function buildAndDispatchVideoData(
  playerResponse: PlayerResponse,
  cancelActiveDownload: (videoId: string) => void
) {
  const { clientVersion, clientName } = readYtcfg();
  const videoData = buildVideoData({ playerResponse, clientVersion, clientName });

  videoDataCache.set(videoData.videoId, videoData);
  videoDataStore.set(videoData.videoId, videoData);
  void crossWorldMessenger.sendMessage(CrossWorldMessage.VideoData, videoData);

  // Start capturing SourceBuffer data for this video
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

  // Flush chunks that arrived before activeVideoId was set (init segments)
  const { pendingChunks } = captureState;
  if (pendingChunks.length > 0) {
    const capture = capturedMedia.get(captureState.activeVideoId)!;
    for (const pending of pendingChunks) {
      addChunkToCapture(capture, pending.mimeType, pending.data);
    }

    console.log(`[ytdl:capture] Flushed ${pendingChunks.length} pending chunks (init segments)`);
    pendingChunks.length = 0;
  }

  // Signal the isolated world once capture state is ready so it can notify
  // the background that this iframe's player is initialized and ready
  if (self !== top) {
    void crossWorldMessenger.sendMessage(CrossWorldMessage.IframePlayerReady, { videoId: videoData.videoId });
  }

  if (location.pathname === "/watch") {
    await injectSegmentedDownloadButton(videoData, cancelActiveDownload);

    // Generate PO token via BotGuard (independent of video playback)
    if (sabrCredentials.value?.poToken) {
      return;
    }

    try {
      const poToken = await generatePoToken(videoData.videoId);
      setPoTokenCredentials(poToken, videoData.sabrConfig?.serverAbrStreamingUrl ?? "");
      // Broadcast to isolated world via synced signal
      sabrCredentials.value = {
        url: videoData.sabrConfig?.serverAbrStreamingUrl ?? "",
        poToken
      };
    } catch (error) {
      console.warn("[ytdl] PO token generation failed:", error);
    }
  }
}

export async function extractAndDispatchVideoData(cancelActiveDownload: (videoId: string) => void) {
  const playerResponse = window.ytInitialPlayerResponse ?? null;
  if (!playerResponse || !location.pathname.startsWith("/watch")) {
    return;
  }

  await buildAndDispatchVideoData(playerResponse, cancelActiveDownload);
}
