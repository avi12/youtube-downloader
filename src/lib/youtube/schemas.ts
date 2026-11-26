import { musicSearchResponseSchema } from "./music-search-types";
import { z } from "@/lib/zod";
import { createGuard, createShapeGuard } from "@/lib/zod-guard";
import {
  type DownloadRequest,
  DownloadType,
  type PlayerResponse,
  type VideoData,
  type YtButtonViewModelElement
} from "@/types";

export const isDownloadType = createGuard(z.enum(DownloadType));

export const playerCaptionTrackDataSchema = z.looseObject({
  languageCode: z.string(),
  vss_id: z.string(),
  displayName: z.string().optional()
});

export const isCaptionBusContext = createGuard(
  z.looseObject({
    state: z.record(z.string(), z.unknown()).optional()
  })
);

export const captionEventBusSchema = z.looseObject({
  subscribe: z.function({
    input: [
      z.string(),
      z.function({
        input: [z.unknown()],
        output: z.void()
      })
    ],
    output: z.void()
  })
});

const botGuardSnapshotSchema = z.function({
  input: [z.array(z.unknown())],
  output: z.string().nullable()
});

export const botGuardVmEntrySchema = z.looseObject({
  a: z.function({
    input: z.array(z.unknown()),
    output: z.tuple([botGuardSnapshotSchema.optional()]).nullish()
  })
});

export const trustedResourceUrlSchema = z.looseObject({
  privateDoNotAccessOrElseTrustedResourceUrlWrappedValue: z.string()
});

export const isTrackDescriptor = createGuard(
  z.looseObject({
    id: z.string(),
    isAutoDubbed: z.unknown()
  })
);

export const playlistVideoEntrySchema = z.looseObject({
  playlistVideoRenderer: z.looseObject({
    videoId: z.string().optional()
  })
});

export const playlistContinuationEntrySchema = z.looseObject({
  continuationItemRenderer: z.looseObject({
    continuationEndpoint: z.looseObject({
      continuationCommand: z.looseObject({
        token: z.string().optional()
      }).optional()
    }).optional()
  })
});

const lockupRendererSchema = z.looseObject({
  contentId: z.string().optional()
});

const videoRendererSchema = z.looseObject({
  videoId: z.string().optional()
});

const lockupCardDataSchema = z.looseObject({
  contentId: z.string().optional(),
  lockupRenderer: lockupRendererSchema.optional(),
  videoRenderer: videoRendererSchema.optional()
});

export const isYtcfg = createGuard(
  z.looseObject({
    get: z.function({
      input: [z.string()],
      output: z.unknown()
    }).optional()
  })
);

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
    runs: z.array(
      z.looseObject({
        text: z.string().optional()
      })
    ).optional()
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

const playerResponseShapeSchema = z.looseObject({
  playabilityStatus: z.looseObject({
    status: z.string()
  })
});

export const isPlayerResponse = createShapeGuard<PlayerResponse>(playerResponseShapeSchema);

export const isVideoData = createShapeGuard<VideoData>(
  z.looseObject({
    videoId: z.string()
  })
);

export const isDownloadRequest = createShapeGuard<DownloadRequest>(
  z.looseObject({
    videoId: z.string(),
    videoItag: z.number(),
    audioItag: z.number(),
    filenameOutput: z.string()
  })
);

export const isMusicSearchResponse = createGuard(musicSearchResponseSchema);

export const tpYtPaperInputSchema = z.looseObject({
  updateStyles: z.function({
    input: [z.record(z.string(), z.string())],
    output: z.void()
  }),
  label: z.string(),
  value: z.string()
});

export const isTpYtPaperInputElement = createGuard(tpYtPaperInputSchema);

const YT_BUTTON_VIEW_MODEL_TAG = "YT-BUTTON-VIEW-MODEL";

// Lazy: `HTMLElement` doesn't exist when WXT imports the entrypoints in Node
export const isYtButtonViewModelElement = createShapeGuard<YtButtonViewModelElement>(
  z.lazy(() => z.instanceof(HTMLElement).refine(element => element.tagName === YT_BUTTON_VIEW_MODEL_TAG))
);

const iconNamedElementSchema = z.looseObject({
  data: z.looseObject({ iconName: z.string() })
});

const isIconNamedElement = createGuard(iconNamedElementSchema);

export function readElementIconName(value: unknown) {
  return isIconNamedElement(value) ? value.data.iconName : undefined;
}

const ytLockupViewModelElementSchema = z.looseObject({
  data: lockupCardDataSchema
});

export type YtLockupViewModelElement = HTMLElement & z.infer<typeof ytLockupViewModelElementSchema>;

export const isYtLockupViewModelElement = createShapeGuard<YtLockupViewModelElement>(ytLockupViewModelElementSchema);

export type YtInitialDataPlaylist = z.infer<typeof ytInitialDataPlaylistSchema>;
export type BrowseContinuationResponse = z.infer<typeof browseContinuationResponseSchema>;
