import { capturedPoToken, capturedPoTokenVideoId, setPoTokenCredentials } from "./credentials";
import {
  extractGenresFromKeywords,
  fetchYouTubeMusicGenres,
  parseDescriptionMetadata,
  parseMusicTitle
} from "./music-metadata";
import { sabrCredentials } from "@/lib/ui/synced-stores.svelte";
import { generatePoToken } from "@/lib/youtube/po-token-generator";
import { fetchMusicThumbnailUrl } from "@/lib/youtube/youtube-music-metadata";
import { getYtcfg, YtcfgKey } from "@/lib/youtube/ytcfg";
import { type VideoData } from "@/types";

export { buildAndDispatchVideoData } from "./capture-dispatch";

export const videoDataCache = new Map<string, VideoData>();

export function readYtcfg() {
  return {
    clientVersion: getYtcfg(YtcfgKey.ClientVersion) ?? "",
    clientName: getYtcfg(YtcfgKey.ClientName) ?? 1
  };
}

export async function buildVideoMetadata(videoId: string) {
  const cached = videoDataCache.get(videoId);
  if (!cached) {
    return null;
  }

  const { playerResponse } = cached;
  const { videoDetails, microformat } = playerResponse;

  const renderer = microformat?.playerMicroformatRenderer;
  const description = videoDetails?.shortDescription ?? "";
  const titleMeta = cached.isMusic ? parseMusicTitle(cached.title) : null;
  const descriptionMeta = cached.isMusic ? parseDescriptionMetadata(description) : null;
  const keywords = videoDetails?.keywords ?? [];
  const genreSet = cached.isMusic ? await fetchYouTubeMusicGenres() : new Set<string>();
  const genres = extractGenresFromKeywords({
    keywords,
    genreSet
  });

  const title = descriptionMeta?.songTitle || titleMeta?.songTitle || cached.title;
  const artist = descriptionMeta?.artist || titleMeta?.fullArtist || videoDetails?.author || "";
  const albumArtist = descriptionMeta?.mainArtist || titleMeta?.mainArtist || undefined;
  const isGenresPresent = genres.length > 0;

  const youtubeThumbnailUrl = videoDetails?.thumbnail?.thumbnails?.at(-1)?.url;
  const searchQuery = `${artist} ${title}`.trim();
  const musicThumbnailUrl = cached.isMusic ? await fetchMusicThumbnailUrl(searchQuery) : undefined;

  return {
    title,
    artist,
    albumArtist: albumArtist !== artist ? albumArtist : undefined,
    album: descriptionMeta?.album,
    genres: isGenresPresent ? genres : undefined,
    date: renderer?.publishDate,
    thumbnailUrl: musicThumbnailUrl ?? youtubeThumbnailUrl,
    isMusic: cached.isMusic
  };
}

const PO_TOKEN_GENERATION_ATTEMPTS = 3;

async function generateAndStorePoToken(videoData: VideoData) {
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
}

// GenerateIT intermittently returns no integrity token; each attempt fetches a fresh
// BotGuard challenge, so retrying recovers the transient that would otherwise dispatch
// SABR unauthenticated and 403.
async function generatePoTokenWithRetries(videoData: VideoData) {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= PO_TOKEN_GENERATION_ATTEMPTS; attempt++) {
    try {
      await generateAndStorePoToken(videoData);
      return null;
    } catch (error) {
      lastError = error;
    }
  }

  return lastError;
}

export async function generatePoTokenIfNeeded(videoData: VideoData) {
  const isCurrentPoTokenPresent = capturedPoToken && capturedPoTokenVideoId === videoData.videoId;
  if (isCurrentPoTokenPresent) {
    return;
  }

  const lastError = await generatePoTokenWithRetries(videoData);
  if (lastError) {
    console.warn("[ytdl] PO token generation failed:", lastError);
  }
}

export { extractAndDispatchVideoData } from "./capture-dispatch";
