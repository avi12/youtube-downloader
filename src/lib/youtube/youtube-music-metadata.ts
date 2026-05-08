import { InnertubeClientName, type InnertubeSearchRequest } from "./innertube";
import type { VideoMetadata } from "@/types";

const SONG_FILTER_PARAMS = "EgWKAQIIAWoKEAkQAxAEEAoQBQ%3D%3D";

interface ThumbnailEntry {
  url: string;
  width: number;
  height: number;
}

interface BrowseEndpoint {
  browseEndpointContextSupportedConfigs?: {
    browseEndpointContextMusicConfig?: {
      pageType?: string;
    };
  };
}

interface SearchRun {
  text: string;
  navigationEndpoint?: {
    browseEndpoint?: BrowseEndpoint;
  };
}

interface FlexColumn {
  musicResponsiveListItemFlexColumnRenderer?: {
    text?: {
      runs?: SearchRun[];
    };
  };
}

interface SearchItem {
  musicResponsiveListItemRenderer?: {
    flexColumns?: FlexColumn[];
    thumbnail?: {
      musicThumbnailRenderer?: {
        thumbnail?: {
          thumbnails?: ThumbnailEntry[];
        };
      };
    };
  };
}

interface MusicSearchResponse {
  contents?: {
    tabbedSearchResultsRenderer?: {
      tabs?: Array<{
        tabRenderer?: {
          content?: {
            sectionListRenderer?: {
              contents?: Array<{
                musicShelfRenderer?: {
                  contents?: SearchItem[];
                };
              }>;
            };
          };
        };
      }>;
    };
  };
}

function extractPageType(run: SearchRun) {
  return run.navigationEndpoint?.browseEndpoint
    ?.browseEndpointContextSupportedConfigs
    ?.browseEndpointContextMusicConfig?.pageType;
}

function parseSearchResult(item: SearchItem) {
  const columns = item.musicResponsiveListItemRenderer?.flexColumns;
  if (!columns || columns.length < 2) {
    return null;
  }

  const [firstColumn, secondColumn] = columns;
  const titleRuns = firstColumn.musicResponsiveListItemFlexColumnRenderer?.text?.runs;
  const metadataRuns = secondColumn.musicResponsiveListItemFlexColumnRenderer?.text?.runs;
  if (!titleRuns || !metadataRuns) {
    return null;
  }

  const songTitle = titleRuns[0]?.text;
  const artists: string[] = [];
  let album: string | undefined;
  let mainArtist: string | undefined;

  for (const run of metadataRuns) {
    const pageType = extractPageType(run);
    if (pageType === "MUSIC_PAGE_TYPE_ARTIST") {
      artists.push(run.text);

      if (!mainArtist) {
        mainArtist = run.text;
      }
    } else if (pageType === "MUSIC_PAGE_TYPE_ALBUM") {
      album = run.text;
    }
  }

  if (!songTitle || artists.length === 0) {
    return null;
  }

  const thumbnails = item.musicResponsiveListItemRenderer?.thumbnail
    ?.musicThumbnailRenderer?.thumbnail?.thumbnails;
  const rawThumbnailUrl = thumbnails?.at(-1)?.url;
  const thumbnailUrl = rawThumbnailUrl?.replace(/=w\d+-h\d+/, "=w544-h544");

  return {
    songTitle,
    artist: artists.join(", "),
    mainArtist,
    album,
    thumbnailUrl
  };
}

export async function fetchYouTubeMusicMetadata({ searchQuery, existingMetadata }: {
  searchQuery: string;
  existingMetadata: VideoMetadata;
}) {
  try {
    const response = await fetch("https://music.youtube.com/youtubei/v1/search?prettyPrint=false", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: searchQuery,
        params: SONG_FILTER_PARAMS,
        context: {
          client: {
            clientName: InnertubeClientName.WebRemix,
            clientVersion: "1.20260408.01.00"
          }
        }
      } satisfies InnertubeSearchRequest)
    });
    if (!response.ok) {
      return existingMetadata;
    }

    const data: MusicSearchResponse = await response.json();
    const contents = data.contents?.tabbedSearchResultsRenderer
      ?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents;

    const songShelf = contents?.find(section => section.musicShelfRenderer?.contents);
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
