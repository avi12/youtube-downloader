import { InnertubeClientName, type InnertubeSearchRequest } from "./innertube";
import { extractFirstSearchItem, parseSearchResult } from "./music-search-parser";
import type { MusicSearchResponse } from "./music-search-parser";
import type { VideoMetadata } from "@/types";

const SONG_FILTER_PARAMS = "EgWKAQIIAWoKEAkQAxAEEAoQBQ%3D%3D";
const YOUTUBE_MUSIC_SEARCH_URL = "https://music.youtube.com/youtubei/v1/search?prettyPrint=false";
const YOUTUBE_MUSIC_CLIENT_VERSION = "1.20260408.01.00";
const CONTENT_TYPE_JSON = "application/json";

async function fetchFirstMusicResult(searchQuery: string) {
  const searchRequest: InnertubeSearchRequest = {
    query: searchQuery,
    params: SONG_FILTER_PARAMS,
    context: {
      client: {
        clientName: InnertubeClientName.WebRemix,
        clientVersion: YOUTUBE_MUSIC_CLIENT_VERSION
      }
    }
  };
  const response = await fetch(YOUTUBE_MUSIC_SEARCH_URL, {
    method: "POST",
    headers: {
      "Content-Type": CONTENT_TYPE_JSON
    },
    body: JSON.stringify(searchRequest)
  });
  const isResponseOk = response.ok;
  if (!isResponseOk) {
    return null;
  }

  const data: MusicSearchResponse = await response.json();
  const firstItem = extractFirstSearchItem(data);
  const isFirstItemMissing = !firstItem;
  if (isFirstItemMissing) {
    return null;
  }

  return parseSearchResult(firstItem);
}

type FetchYouTubeMusicMetadataParams = {
  searchQuery: string;
  existingMetadata: VideoMetadata;
};
export async function fetchYouTubeMusicMetadata({ searchQuery, existingMetadata }: FetchYouTubeMusicMetadataParams) {
  try {
    const parsed = await fetchFirstMusicResult(searchQuery);
    const isParsedMissing = !parsed;
    if (isParsedMissing) {
      return existingMetadata;
    }

    const isAlbumArtistDifferent = parsed.mainArtist !== parsed.artist;
    return {
      ...existingMetadata,
      title: parsed.songTitle || existingMetadata.title,
      artist: parsed.artist || existingMetadata.artist,
      albumArtist: isAlbumArtistDifferent ? parsed.mainArtist : existingMetadata.albumArtist,
      album: parsed.album || existingMetadata.album,
      thumbnailUrl: parsed.thumbnailUrl || existingMetadata.thumbnailUrl
    };
  } catch {
    return existingMetadata;
  }
}

export async function fetchMusicThumbnailUrl(searchQuery: string) {
  const isSearchQueryEmpty = !searchQuery;
  if (isSearchQueryEmpty) {
    return undefined;
  }

  try {
    const result = await fetchFirstMusicResult(searchQuery);
    return result?.thumbnailUrl;
  } catch {
    return undefined;
  }
}
