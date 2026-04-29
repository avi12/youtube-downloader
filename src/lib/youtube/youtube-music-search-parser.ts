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

export interface SearchItem {
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

function extractPageType(run: SearchRun) {
  const config = run.navigationEndpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs;
  return config?.browseEndpointContextMusicConfig?.pageType;
}

export function parseSearchResult(item: SearchItem) {
  const columns = item.musicResponsiveListItemRenderer?.flexColumns;
  if (!columns || columns.length < 2) {
    return null;
  }

  const titleRuns = columns[0].musicResponsiveListItemFlexColumnRenderer?.text?.runs;
  const metadataRuns = columns[1].musicResponsiveListItemFlexColumnRenderer?.text?.runs;
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

  const thumbnails = item.musicResponsiveListItemRenderer?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails;
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
