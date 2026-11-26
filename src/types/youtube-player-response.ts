import type { Prettify } from "./prettify";
import {
  adaptiveFormatSchema,
  formatItemSchema,
  playerCaptionTrackSchema,
  playerTranslationLanguageSchema
} from "./youtube-format-types";
import { z } from "@/lib/zod";
import { tolerated } from "@/lib/zod-guard";

const videoDetailsSchema = z.looseObject({
  videoId: z.string(),
  title: z.string().optional(),
  lengthSeconds: z.string().optional(),
  channelId: z.string().optional(),
  shortDescription: z.string().optional(),
  keywords: z.array(z.string()).optional(),
  thumbnail: z.looseObject({
    thumbnails: z.array(
      z.looseObject({
        url: z.string(),
        width: z.number().optional(),
        height: z.number().optional()
      })
    ).optional()
  }).optional(),
  viewCount: z.string().optional(),
  author: z.string().optional(),
  isPrivate: z.boolean().optional(),
  isLiveContent: z.boolean().optional(),
  isLive: z.boolean().optional(),
  allowRatings: z.boolean().optional()
});

const simpleTextSchema = z.looseObject({
  simpleText: z.string().optional()
});

const microformatSchema = z.looseObject({
  microformatDataRenderer: z.looseObject({
    category: z.string().optional()
  }).optional(),
  playerMicroformatRenderer: z.looseObject({
    liveBroadcastDetails: z.looseObject({
      isLiveNow: z.boolean().optional(),
      startTimestamp: z.string().optional()
    }).optional(),
    title: simpleTextSchema.optional(),
    description: simpleTextSchema.optional(),
    lengthSeconds: z.string().optional(),
    category: z.string().optional(),
    publishDate: z.string().optional(),
    ownerChannelName: z.string().optional()
  }).optional()
});

const streamingDataSchema = z.looseObject({
  expiresInSeconds: z.string().optional(),
  formats: z.array(formatItemSchema).optional(),
  adaptiveFormats: z.array(adaptiveFormatSchema).optional(),
  serverAbrStreamingUrl: z.string().optional()
});

const playerConfigSchema = z.looseObject({
  mediaCommonConfig: z.looseObject({
    mediaUstreamerRequestConfig: z.looseObject({
      videoPlaybackUstreamerConfig: z.string().optional()
    }).optional()
  }).optional()
});

const captionsSchema = z.looseObject({
  playerCaptionsTracklistRenderer: z.looseObject({
    captionTracks: z.array(playerCaptionTrackSchema).optional(),
    translationLanguages: z.array(playerTranslationLanguageSchema).optional()
  })
});

/** Only `playabilityStatus.status` is guaranteed. @see https://github.com/LuanRT/YouTube.js/blob/main/src/parser/types/ParsedResponse.ts */
export const playerResponseSchema = z.looseObject({
  playabilityStatus: z.looseObject({
    status: z.string(),
    reason: tolerated(z.string()),
    messages: tolerated(z.array(z.string()))
  }),
  videoDetails: tolerated(videoDetailsSchema),
  microformat: tolerated(microformatSchema),
  streamingData: tolerated(streamingDataSchema),
  playerConfig: tolerated(playerConfigSchema),
  captions: tolerated(captionsSchema)
});

export type PlayerResponse = Prettify<z.infer<typeof playerResponseSchema>>;
