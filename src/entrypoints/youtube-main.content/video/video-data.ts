import { injectSegmentedDownloadButton } from "../watch-button/watch-button";
import { capturedPoToken, capturedPoTokenVideoId, setPoTokenCredentials } from "./credentials";
import { buildVideoData } from "./youtube-api";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";
import { sabrCredentials, videoDataStore } from "@/lib/ui/synced-stores.svelte";
import { getMoviePlayer } from "@/lib/youtube/movie-player";
import { generatePoToken } from "@/lib/youtube/po-token-generator";
import { type PlayerResponse, type VideoData, type YtdlCaptureState } from "@/types";

declare const ytcfg: {
  get: (key: string) => unknown;
} | undefined;

export const videoDataCache = new Map<string, VideoData>();

// Fallback no-op stub for pages where sourcebuffer-capture.content.ts didn't initialize.
const captureState: YtdlCaptureState = window.__ytdlCapture ?? {
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
  return {
    clientVersion,
    clientName
  };
}

export async function buildVideoMetadata(videoId: string) {
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
  const keywords = videoDetails?.keywords ?? [];
  const genreSet = await fetchYouTubeMusicGenres();
  const genres = extractGenresFromKeywords({
    keywords,
    genreSet
  });

  const artist = descriptionMeta.artist || titleMeta.fullArtist || videoDetails?.author || "";
  const albumArtist = descriptionMeta.mainArtist || titleMeta.mainArtist || undefined;

  return {
    title: descriptionMeta.songTitle || titleMeta.songTitle,
    artist,
    albumArtist: albumArtist !== artist ? albumArtist : undefined,
    album: descriptionMeta.album,
    genres: genres.length > 0 ? genres : undefined,
    date: renderer?.publishDate,
    thumbnailUrl,
    isMusic: cached.isMusic
  };
}

let cachedYouTubeMusicGenres: Set<string> | null = null;

async function fetchYouTubeMusicGenres() {
  if (cachedYouTubeMusicGenres) {
    return cachedYouTubeMusicGenres;
  }

  try {
    const response = await fetch("https://music.youtube.com/youtubei/v1/browse?prettyPrint=false", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        browseId: "FEmusic_moods_and_genres",
        context: {
          client: {
            clientName: "WEB_REMIX",
            clientVersion: "1.20260408.01.00"
          }
        }
      })
    });

    const data = await response.json();
    const sections = data.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]
      ?.tabRenderer?.content?.sectionListRenderer?.contents ?? [];

    const genres = new Set<string>();
    for (const section of sections) {
      for (const item of section.gridRenderer?.items ?? []) {
        const title = item.musicNavigationButtonRenderer?.buttonText?.runs?.[0]?.text;
        if (title) {
          genres.add(title.toLowerCase());
        }
      }
    }

    cachedYouTubeMusicGenres = genres;
    return genres;
  } catch {
    return new Set<string>();
  }
}

function extractGenresFromKeywords({ keywords, genreSet }: {
  keywords: string[];
  genreSet: Set<string>;
}) {
  const matched = new Set<string>();
  for (const keyword of keywords) {
    const normalized = keyword.toLowerCase().trim();
    if (genreSet.has(normalized)) {
      matched.add(keyword.trim());
    }
  }

  return [...matched];
}

const videoTitleSuffixPattern = /\s*[[(](?:official\s+(?:music\s+)?video|(?:official\s+)?lyric(?:s)?\s*(?:video)?|(?:official\s+)?audio|4k\s*remaster(?:ed)?|remaster(?:ed)?|hd|hq|visualizer|clip\s+officiel|video\s*oficial)[)\]]\s*/gi;

const featuringPattern = /\s+(?:ft\.?|feat\.?|featuring)\s+(.+)$/i;

function parseMusicTitle(title: string) {
  const cleaned = title.replaceAll(videoTitleSuffixPattern, "").trim();

  const iSeparator = cleaned.search(/\s[-–]\s/);
  if (iSeparator === -1) {
    return {
      mainArtist: "",
      fullArtist: "",
      songTitle: cleaned
    };
  }

  const mainArtist = cleaned.slice(0, iSeparator).trim();
  const afterSeparator = cleaned.slice(iSeparator + 3).trim();

  const featMatch = afterSeparator.match(featuringPattern);
  const songTitle = afterSeparator.replace(featuringPattern, "").trim();
  const fullArtist = featMatch
    ? `${mainArtist} feat. ${featMatch[1].trim()}`
    : mainArtist;

  return {
    mainArtist,
    fullArtist,
    songTitle
  };
}

function parseDescriptionMetadata(description: string) {
  if (!description.startsWith("Provided to YouTube")) {
    return {
      songTitle: undefined,
      artist: undefined,
      mainArtist: undefined,
      album: undefined
    };
  }

  const lines = description.split("\n").filter(line => line.trim());
  const titleArtistLine = lines[1] ?? "";
  const [rawTitle, ...artists] = titleArtistLine.split(" · ");
  const songTitle = rawTitle?.trim() || undefined;
  const mainArtist = artists[0]?.trim() || undefined;
  const artist = artists.join(", ") || undefined;
  const album = lines[2]?.trim() || undefined;

  return {
    songTitle,
    artist,
    mainArtist,
    album
  };
}

export async function generatePoTokenIfNeeded(videoData: VideoData) {
  if (capturedPoToken && capturedPoTokenVideoId === videoData.videoId) {
    return;
  }

  try {
    const poToken = await generatePoToken(videoData.videoId);
    const { serverAbrStreamingUrl: sabrUrl = "" } = videoData.sabrConfig ?? {};
    setPoTokenCredentials({
      poToken,
      sabrUrl,
      videoId: videoData.videoId
    });
    sabrCredentials.value = {
      url: sabrCredentials.value?.url || sabrUrl,
      poToken
    };
  } catch (error) {
    console.warn("[ytdl] PO token generation failed:", error);
  }
}

export async function buildAndDispatchVideoData({ playerResponse, cancelActiveDownload }: {
  playerResponse: PlayerResponse;
  cancelActiveDownload: (videoId: string) => void;
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

  if (self !== top) {
    // Stop the player before generating the PO token so its SABR session is released
    // before the background download starts a new one for the same video.
    getMoviePlayer()?.stopVideo?.();

    await generatePoTokenIfNeeded(videoData);
    void crossWorldMessenger.sendMessage(CrossWorldMessage.IframePlayerReady, { videoId: videoData.videoId });
    return;
  }

  if (location.pathname === "/watch") {
    await injectSegmentedDownloadButton(videoData, cancelActiveDownload);
  }
}

const PLAYER_RESPONSE_POLL_ATTEMPTS = 20;
const PLAYER_RESPONSE_POLL_INTERVAL_MS = 250;

export async function extractAndDispatchVideoData(cancelActiveDownload: (videoId: string) => void) {
  if (!location.pathname.startsWith("/watch")) {
    return;
  }

  for (let attempt = 0; attempt < PLAYER_RESPONSE_POLL_ATTEMPTS; attempt++) {
    const playerResponse = window.ytInitialPlayerResponse ?? null;
    const isReady = playerResponse?.videoDetails?.videoId
      && playerResponse.playabilityStatus?.status !== "UNPLAYABLE";
    if (isReady) {
      await buildAndDispatchVideoData({
        playerResponse,
        cancelActiveDownload
      });
      return;
    }

    await new Promise(resolve => setTimeout(resolve, PLAYER_RESPONSE_POLL_INTERVAL_MS));
  }
}
