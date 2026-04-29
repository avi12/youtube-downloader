import type { SearchItem } from "./youtube-music-search-parser";
import { parseSearchResult } from "./youtube-music-search-parser";
import type { VideoMetadata } from "@/types";

const YOUTUBE_MUSIC_SEARCH_URL = "https://music.youtube.com/youtubei/v1/search?prettyPrint=false";
const SONG_FILTER_PARAMS = "EgWKAQIIAWoKEAkQAxAEEAoQBQ%3D%3D";

export async function fetchYouTubeMusicMetadata({ searchQuery, existingMetadata }: {
  searchQuery: string;
  existingMetadata: VideoMetadata;
}) {
  try {
    const response = await fetch(YOUTUBE_MUSIC_SEARCH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: searchQuery,
        params: SONG_FILTER_PARAMS,
        context: {
          client: {
            clientName: "WEB_REMIX",
            clientVersion: "1.20260408.01.00"
          }
        }
      })
    });
    if (!response.ok) {
      return existingMetadata;
    }

    const data = await response.json();
    const tabContent = data.contents?.tabbedSearchResultsRenderer?.tabs?.[0]?.tabRenderer?.content;
    const contents = tabContent?.sectionListRenderer?.contents;

    const songShelf = contents?.find((section: {
      musicShelfRenderer?: { contents?: SearchItem[] };
    }) => section.musicShelfRenderer?.contents);
    const firstItem = songShelf?.musicShelfRenderer?.contents?.[0];
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
