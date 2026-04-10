import { capturedPoToken, setPoTokenCredentials } from "./credentials";
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
  const { videoDetails, microformat } = playerResponse;
  const { thumbnail } = videoDetails ?? {};
  const thumbnails = thumbnail?.thumbnails ?? [];
  const thumbnailUrl = thumbnails.length > 0
    ? thumbnails[thumbnails.length - 1].url
    : undefined;

  const renderer = microformat?.playerMicroformatRenderer;
  const description = videoDetails?.shortDescription ?? "";
  const titleMeta = parseMusicTitle(cached.title);
  const descriptionMeta = parseDescriptionMetadata(description);
  const genre = renderer?.category === "Music" ? "Music" : renderer?.category;

  const artist = descriptionMeta.artist || titleMeta.fullArtist || videoDetails?.author || "";
  const albumArtist = descriptionMeta.mainArtist || titleMeta.mainArtist || undefined;

  return {
    title: descriptionMeta.songTitle || titleMeta.songTitle,
    artist,
    albumArtist: albumArtist !== artist ? albumArtist : undefined,
    album: descriptionMeta.album,
    genre,
    description: description.slice(0, 500),
    date: renderer?.publishDate,
    thumbnailUrl,
    isMusic: cached.isMusic
  };
}

const videoTitleSuffixPattern = /\s*[\[(](?:official\s+(?:music\s+)?video|(?:official\s+)?lyric(?:s)?\s*(?:video)?|(?:official\s+)?audio|4k\s*remaster(?:ed)?|remaster(?:ed)?|hd|hq|visualizer|clip\s+officiel|video\s*oficial)[\])]\s*/gi;

const featuringPattern = /\s+(?:ft\.?|feat\.?|featuring)\s+(.+)$/i;

function parseMusicTitle(title: string) {
  const cleaned = title.replaceAll(videoTitleSuffixPattern, "").trim();

  const separatorIndex = cleaned.search(/\s[-–]\s/);
  if (separatorIndex === -1) {
    return { mainArtist: "", fullArtist: "", songTitle: cleaned };
  }

  const mainArtist = cleaned.slice(0, separatorIndex).trim();
  const afterSeparator = cleaned.slice(separatorIndex + 3).trim();

  const featMatch = afterSeparator.match(featuringPattern);
  const songTitle = afterSeparator.replace(featuringPattern, "").trim();
  const fullArtist = featMatch
    ? `${mainArtist} feat. ${featMatch[1].trim()}`
    : mainArtist;

  return { mainArtist, fullArtist, songTitle };
}

function parseDescriptionMetadata(description: string) {
  if (!description.startsWith("Provided to YouTube")) {
    return { songTitle: undefined, artist: undefined, mainArtist: undefined, album: undefined };
  }

  const lines = description.split("\n").filter(line => line.trim());
  const titleArtistLine = lines[1] ?? "";
  const parts = titleArtistLine.split(" · ");
  const songTitle = parts[0]?.trim() || undefined;
  const artists = parts.slice(1);
  const mainArtist = artists[0]?.trim() || undefined;
  const artist = artists.join(", ") || undefined;
  const album = lines[2]?.trim() || undefined;

  return { songTitle, artist, mainArtist, album };
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

    // Generate PO token via BotGuard (independent of video playback).
    // Use capturedPoToken (module var) as the guard — sabrCredentials.value.poToken
    // may hold the truncated 15-byte captured token which is not a valid BotGuard token.
    if (capturedPoToken) {
      return;
    }

    try {
      const poToken = await generatePoToken(videoData.videoId);
      const { serverAbrStreamingUrl: sabrUrl = "" } = videoData.sabrConfig ?? {};
      setPoTokenCredentials(poToken, sabrUrl);
      // Broadcast to isolated world via synced signal.
      // Preserve the isolated world's captured URL (has decrypted n param) if already set.
      sabrCredentials.value = {
        url: sabrCredentials.value?.url || sabrUrl,
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
