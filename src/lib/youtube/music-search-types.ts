import { z } from "@/lib/zod";
import type { Prettify } from "@/types";

const thumbnailEntrySchema = z.looseObject({
  url: z.string()
});

const browseEndpointSchema = z.looseObject({
  browseEndpointContextSupportedConfigs: z.looseObject({
    browseEndpointContextMusicConfig: z.looseObject({
      pageType: z.string().optional()
    }).optional()
  }).optional()
});

const searchRunSchema = z.looseObject({
  text: z.string(),
  navigationEndpoint: z.looseObject({
    browseEndpoint: browseEndpointSchema.optional()
  }).optional()
});

const flexColumnSchema = z.looseObject({
  musicResponsiveListItemFlexColumnRenderer: z.looseObject({
    text: z.looseObject({
      runs: z.array(searchRunSchema).optional()
    }).optional()
  }).optional()
});

const searchItemSchema = z.looseObject({
  musicResponsiveListItemRenderer: z.looseObject({
    flexColumns: z.array(flexColumnSchema).optional(),
    thumbnail: z.looseObject({
      musicThumbnailRenderer: z.looseObject({
        thumbnail: z.looseObject({
          thumbnails: z.array(thumbnailEntrySchema).optional()
        }).optional()
      }).optional()
    }).optional()
  }).optional()
});

const shelfSectionSchema = z.looseObject({
  musicShelfRenderer: z.looseObject({
    contents: z.array(searchItemSchema).optional()
  }).optional()
});

const searchTabSchema = z.looseObject({
  tabRenderer: z.looseObject({
    content: z.looseObject({
      sectionListRenderer: z.looseObject({
        contents: z.array(shelfSectionSchema).optional()
      }).optional()
    }).optional()
  }).optional()
});

export const musicSearchResponseSchema = z.looseObject({
  contents: z.looseObject({
    tabbedSearchResultsRenderer: z.looseObject({
      tabs: z.array(searchTabSchema).optional()
    }).optional()
  }).optional()
});

export type SearchRun = Prettify<z.infer<typeof searchRunSchema>>;

export type SearchItem = Prettify<z.infer<typeof searchItemSchema>>;

export type MusicSearchResponse = Prettify<z.infer<typeof musicSearchResponseSchema>>;
