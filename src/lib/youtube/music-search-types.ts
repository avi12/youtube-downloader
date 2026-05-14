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

export interface SearchRun {
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

export interface MusicSearchResponse {
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
