import { z } from "zod";

export const playerCaptionTrackDataSchema = z.looseObject({
  languageCode: z.string(),
  vss_id: z.string()
});

export const captionBusContextSchema = z.looseObject({
  state: z.record(z.string(), z.unknown()).optional()
});

export const captionEventBusSchema = z.looseObject({
  subscribe: z.function()
});

export const botGuardVmEntrySchema = z.looseObject({
  a: z.function()
});

export const trustedResourceUrlSchema = z.looseObject({
  privateDoNotAccessOrElseTrustedResourceUrlWrappedValue: z.string()
});

export const trackDescriptorSchema = z.looseObject({
  id: z.string(),
  isAutoDubbed: z.unknown()
});

export const playlistVideoEntrySchema = z.looseObject({
  playlistVideoRenderer: z.looseObject({
    videoId: z.string().optional()
  }).optional()
});

export const playlistContinuationEntrySchema = z.looseObject({
  continuationItemRenderer: z.looseObject({
    continuationEndpoint: z.looseObject({
      continuationCommand: z.looseObject({
        token: z.string().optional()
      }).optional()
    }).optional()
  }).optional()
});

const lockupRendererSchema = z.looseObject({
  contentId: z.string().optional()
});

const videoRendererSchema = z.looseObject({
  videoId: z.string().optional()
});

export const lockupCardDataSchema = z.looseObject({
  contentId: z.string().optional(),
  lockupRenderer: lockupRendererSchema.optional(),
  videoRenderer: videoRendererSchema.optional()
});

export const ytcfgSchema = z.looseObject({
  get: z.function().optional()
});

const continuationItemListSchema = z.looseObject({
  continuationItems: z.array(z.unknown()).optional()
});

const appendContinuationActionSchema = z.looseObject({
  appendContinuationItemsAction: continuationItemListSchema.optional()
});

export const browseContinuationResponseSchema = z.looseObject({
  onResponseReceivedActions: z.array(appendContinuationActionSchema).optional()
});

const playlistVideoListRendererSchema = z.looseObject({
  contents: z.array(z.unknown()).optional()
});

const itemSectionContentSchema = z.looseObject({
  playlistVideoListRenderer: playlistVideoListRendererSchema.optional()
});

const itemSectionRendererSchema = z.looseObject({
  contents: z.array(itemSectionContentSchema).optional()
});

const sectionContentSchema = z.looseObject({
  itemSectionRenderer: itemSectionRendererSchema.optional()
});

const sectionListRendererSchema = z.looseObject({
  contents: z.array(sectionContentSchema).optional()
});

const tabContentSchema = z.looseObject({
  sectionListRenderer: sectionListRendererSchema.optional()
});

const tabRendererSchema = z.looseObject({
  content: tabContentSchema.optional()
});

const tabEntrySchema = z.looseObject({
  tabRenderer: tabRendererSchema.optional()
});

const playlistTwoColumnSchema = z.looseObject({
  twoColumnBrowseResultsRenderer: z.looseObject({
    tabs: z.array(tabEntrySchema).optional()
  }).optional()
});

const playlistHeaderRendererSchema = z.looseObject({
  title: z.looseObject({
    simpleText: z.string().optional()
  }).optional(),
  ownerText: z.looseObject({
    runs: z.array(z.looseObject({
      text: z.string().optional()
    })).optional()
  }).optional()
});

const playlistMetadataRendererSchema = z.looseObject({
  title: z.string().optional()
});

export const ytInitialDataPlaylistSchema = z.looseObject({
  contents: playlistTwoColumnSchema.optional(),
  header: z.looseObject({
    playlistHeaderRenderer: playlistHeaderRendererSchema.optional()
  }).optional(),
  metadata: z.looseObject({
    playlistMetadataRenderer: playlistMetadataRendererSchema.optional()
  }).optional()
});

export type PlayerCaptionTrackData = z.infer<typeof playerCaptionTrackDataSchema>;
export type LockupCardData = z.infer<typeof lockupCardDataSchema>;
export type YtInitialDataPlaylist = z.infer<typeof ytInitialDataPlaylistSchema>;
export type BrowseContinuationResponse = z.infer<typeof browseContinuationResponseSchema>;
export type PlaylistVideoEntry = z.infer<typeof playlistVideoEntrySchema>;
export type PlaylistContinuationEntry = z.infer<typeof playlistContinuationEntrySchema>;
