import type { Prettify } from "@/types";

type ThumbnailEntry = Prettify<{
  url: string;
  width: number;
  height: number;
}>;

type BrowseEndpoint = Prettify<{
  browseEndpointContextSupportedConfigs?: {
    browseEndpointContextMusicConfig?: {
      pageType?: string;
    };
  };
}>;

export type SearchRun = Prettify<{
  text: string;
  navigationEndpoint?: {
    browseEndpoint?: BrowseEndpoint;
  };
}>;

type FlexColumn = Prettify<{
  musicResponsiveListItemFlexColumnRenderer?: {
    text?: {
      runs?: SearchRun[];
    };
  };
}>;

export type SearchItem = Prettify<{
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
}>;

export type MusicSearchResponse = Prettify<{
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
}>;
