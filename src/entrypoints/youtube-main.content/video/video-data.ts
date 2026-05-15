import { capturedPoToken, capturedPoTokenVideoId, setPoTokenCredentials } from "./credentials";
import {
  extractGenresFromKeywords,
  fetchYouTubeMusicGenres,
  parseDescriptionMetadata,
  parseMusicTitle
} from "./music-metadata";
import { sabrCredentials } from "@/lib/ui/synced-stores.svelte";
import { generatePoToken } from "@/lib/youtube/po-token-generator";
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
  const thumbnails = videoDetails?.thumbnail?.thumbnails ?? [];
  const thumbnailUrl = thumbnails.length > 0 ? thumbnails[thumbnails.length - 1].url : undefined;

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

export async function generatePoTokenIfNeeded(videoData: VideoData) {
  const hasCurrentPoToken = capturedPoToken && capturedPoTokenVideoId === videoData.videoId;
  if (hasCurrentPoToken) {
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

export { extractAndDispatchVideoData } from "./capture-dispatch";
