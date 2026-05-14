import { InnertubeClientName, type InnertubeSearchRequest } from "./innertube";
import { extractFirstSearchItem, parseSearchResult } from "./music-search-parser";
import type { MusicSearchResponse } from "./music-search-parser";
import type { VideoMetadata } from "@/types";

const SONG_FILTER_PARAMS = "EgWKAQIIAWoKEAkQAxAEEAoQBQ%3D%3D";

export async function fetchYouTubeMusicMetadata({ searchQuery, existingMetadata }: {
  searchQuery: string;
  existingMetadata: VideoMetadata;
}) {
  try {
    const searchRequest: InnertubeSearchRequest = {
      query: searchQuery,
      params: SONG_FILTER_PARAMS,
      context: {
        client: {
          clientName: InnertubeClientName.WebRemix,
          clientVersion: "1.20260408.01.00"
        }
      }
    };
    const response = await fetch("https://music.youtube.com/youtubei/v1/search?prettyPrint=false", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(searchRequest)
    });
    if (!response.ok) {
      return existingMetadata;
    }

    const data: MusicSearchResponse = await response.json();
    const firstItem = extractFirstSearchItem(data);
    if (!firstItem) {
      return existingMetadata;
    }

    const parsed = parseSearchResult(firstItem);
    if (!parsed) {
      return existingMetadata;
    }

    return {
      ...existingMetadata,
      title: parsed.songTitle || existingMetadata.title,
      artist: parsed.artist || existingMetadata.artist,
      albumArtist: parsed.mainArtist !== parsed.artist ? parsed.mainArtist : existingMetadata.albumArtist,
      album: parsed.album || existingMetadata.album,
      thumbnailUrl: parsed.thumbnailUrl || existingMetadata.thumbnailUrl
    };
  } catch {
    return existingMetadata;
  }
}
