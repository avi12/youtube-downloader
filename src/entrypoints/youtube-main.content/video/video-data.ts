import { injectSegmentedDownloadButton } from "../watch-button/watch-button";
import { capturedPoToken, capturedPoTokenVideoId, setPoTokenCredentials } from "./credentials";
import { buildVideoData } from "./youtube-api";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";
import { sabrCredentials, videoDataStore } from "@/lib/ui/synced-stores.svelte";
import { generatePoToken, refreshPoToken } from "@/lib/youtube/po-token-generator";
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

const PO_TOKEN_BROADCAST_INTERVAL_MS = 3_000;
const activePoTokenBroadcasts = new Set<string>();

async function broadcastFreshPoToken(videoId: string) {
  try {
    const freshToken = await refreshPoToken(videoId);
    if (freshToken) {
      void crossWorldMessenger.sendMessage(CrossWorldMessage.PoTokenRefreshed, {
        videoId,
        poToken: freshToken
      });
    }
  } catch { /* next tick retries */ }
}

function startPoTokenRefreshBroadcast(videoId: string) {
  if (activePoTokenBroadcasts.has(videoId)) {
    return;
  }

  activePoTokenBroadcasts.add(videoId);
  void broadcastFreshPoToken(videoId);
  setInterval(() => void broadcastFreshPoToken(videoId), PO_TOKEN_BROADCAST_INTERVAL_MS);
}

export async function generatePoTokenIfNeeded(videoData: VideoData) {
  if (capturedPoToken && capturedPoTokenVideoId === videoData.videoId) {
    return;
  }

  try {
    // The ANDROID_VR PO token only feeds the alternate-client CDN-fallback, which
    // never triggers on Chrome (SABR succeeds), so skip the second BotGuard mint
    // there. Firefox's SABR can fail when YouTube flips into attestation mode,
    // so we pre-mint the fallback token at click-time.
    const [poToken, alternateClientPoToken] = await Promise.all([
      generatePoToken({ videoId: videoData.videoId }),
      import.meta.env.FIREFOX
        ? generatePoToken({
          videoId: videoData.videoId,
          clientName: "ANDROID_VR",
          clientVersion: "1.65.10"
        }).catch(() => "")
        : Promise.resolve("")
    ]);
    const { serverAbrStreamingUrl: sabrUrl = "" } = videoData.sabrConfig ?? {};
    setPoTokenCredentials({
      poToken,
      alternateClientPoToken,
      sabrUrl,
      videoId: videoData.videoId
    });
    sabrCredentials.value = {
      url: sabrCredentials.value?.url || sabrUrl,
      poToken
    };
    startPoTokenRefreshBroadcast(videoData.videoId);
  } catch (error) {
    console.warn("[ytdl] PO token generation failed:", error);
  }
}

function readPlayerAudioLanguage() {
  const elPlayer = document.querySelector<HTMLElement & {
    getAudioTrack?: () => { language?: string } | null;
  }>("#movie_player");
  return elPlayer?.getAudioTrack?.()?.language ?? "";
}

function readPlayerCaptionLanguage() {
  const elPlayer = document.querySelector<HTMLElement & {
    getOption?: (module: string, key: string) => { languageCode?: string } | null;
  }>("#movie_player");
  return elPlayer?.getOption?.("captions", "track")?.languageCode ?? "";
}

export async function buildAndDispatchVideoData({ playerResponse, cancelActiveDownload, preferredAudioLanguage = "", preferredCaptionLanguage = "" }: {
  playerResponse: PlayerResponse;
  cancelActiveDownload: (videoId: string) => void;
  preferredAudioLanguage?: string;
  preferredCaptionLanguage?: string;
}) {
  const { clientVersion, clientName } = readYtcfg();
  const videoData = buildVideoData({
    playerResponse,
    clientVersion,
    clientName,
    preferredAudioLanguage,
    preferredCaptionLanguage
  });

  videoDataCache.set(videoData.videoId, videoData);
  videoDataStore.set(videoData.videoId, videoData);
  void crossWorldMessenger.sendMessage(CrossWorldMessage.VideoData, videoData);

  // Bind capture only inside download/scrub iframes (self !== top). On the
  // user's top-level watch page nothing reads from __ytdlCapture — leaving
  // activeVideoId unbound prevents every appendBuffer call from copying its
  // payload via .slice() on the main thread for the entire playback session,
  // which was the source of the watch-page lag.
  if (self !== top) {
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

    // Stop the player before generating the PO token so its SABR session is released
    // before the background download starts a new one for the same video.
    const elPlayer = document.querySelector<HTMLElement & {
      pauseVideo?: () => void;
      stopVideo?: () => void;
    }>("#movie_player");
    elPlayer?.pauseVideo?.();
    elPlayer?.stopVideo?.();

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
        cancelActiveDownload,
        preferredAudioLanguage: readPlayerAudioLanguage(),
        preferredCaptionLanguage: readPlayerCaptionLanguage()
      });
      return;
    }

    await new Promise(resolve => setTimeout(resolve, PLAYER_RESPONSE_POLL_INTERVAL_MS));
  }
}
