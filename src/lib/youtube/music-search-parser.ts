import type { MusicSearchResponse, SearchItem, SearchRun } from "./music-search-types";

export type { MusicSearchResponse } from "./music-search-types";

function extractPageType(run: SearchRun) {
  return run.navigationEndpoint?.browseEndpoint
    ?.browseEndpointContextSupportedConfigs
    ?.browseEndpointContextMusicConfig?.pageType;
}

export function parseSearchResult(item: SearchItem) {
  const columns = item.musicResponsiveListItemRenderer?.flexColumns;
  const isColumnsMissing = !columns || columns.length < 2;
  if (isColumnsMissing) {
    return null;
  }

  const [firstColumn, secondColumn] = columns;
  const titleRuns = firstColumn.musicResponsiveListItemFlexColumnRenderer?.text?.runs;
  const metadataRuns = secondColumn.musicResponsiveListItemFlexColumnRenderer?.text?.runs;
  const isRunsMissing = !titleRuns || !metadataRuns;
  if (isRunsMissing) {
    return null;
  }

  const [firstTitleRun] = titleRuns;
  const songTitle = firstTitleRun?.text;
  const artists: string[] = [];
  let album: string | undefined;
  let mainArtist: string | undefined;

  for (const run of metadataRuns) {
    const pageType = extractPageType(run);
    const isArtistPage = pageType === "MUSIC_PAGE_TYPE_ARTIST";
    const isAlbumPage = pageType === "MUSIC_PAGE_TYPE_ALBUM";
    if (isArtistPage) {
      artists.push(run.text);

      if (!mainArtist) {
        mainArtist = run.text;
      }
    } else if (isAlbumPage) {
      album = run.text;
    }
  }

  const isResultInvalid = !songTitle || artists.length === 0;
  if (isResultInvalid) {
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

export function extractFirstSearchItem(data: MusicSearchResponse) {
  const contents = data.contents?.tabbedSearchResultsRenderer
    ?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents;
  const songShelf = contents?.find(section => section.musicShelfRenderer?.contents);
  return songShelf?.musicShelfRenderer?.contents?.[0] ?? null;
}
