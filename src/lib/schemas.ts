import { z } from "zod";

function lenientArray<Schema extends z.ZodType>(schema: Schema) {
  return z.array(z.unknown()).transform(items => items.flatMap(item => {
    const result = schema.safeParse(item);
    return result.success ? [result.data] : [];
  }));
}

const audioTrackSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  audioIsDefault: z.boolean().optional()
});

export const streamFormatSchema = z.object({
  itag: z.number(),
  url: z.string().optional(),
  mimeType: z.string(),
  bitrate: z.number().default(0),
  contentLength: z.string().optional(),
  height: z.number().optional(),
  width: z.number().optional(),
  fps: z.number().optional(),
  audioTrack: audioTrackSchema.optional(),
  lastModified: z.union([z.string(), z.number()]).transform(String).optional(),
  xtags: z.string().optional(),
  quality: z.string().optional(),
  qualityLabel: z.string().optional(),
  averageBitrate: z.number().optional(),
  audioQuality: z.string().optional(),
  approxDurationMs: z.string().optional()
});

export const thumbnailSchema = z.object({
  url: z.string(),
  width: z.number().default(0),
  height: z.number().default(0)
});

const captionTrackSchema = z.object({
  baseUrl: z.string(),
  languageCode: z.string(),
  name: z.object({ simpleText: z.string().optional() }).optional(),
  kind: z.string().optional()
});

export const playerResponseSchema = z.object({
  playabilityStatus: z.object({
    status: z.string().optional(),
    reason: z.string().optional()
  }).optional(),
  videoDetails: z.object({
    title: z.string().optional(),
    author: z.string().optional(),
    shortDescription: z.string().optional(),
    lengthSeconds: z.string().optional(),
    viewCount: z.string().optional(),
    channelId: z.string().optional(),
    keywords: z.array(z.string()).optional(),
    isLive: z.boolean().optional(),
    thumbnail: z.object({ thumbnails: lenientArray(thumbnailSchema).optional() }).optional()
  }).optional(),
  microformat: z.object({
    playerMicroformatRenderer: z.object({
      uploadDate: z.string().optional(),
      category: z.string().optional()
    }).optional()
  }).optional(),
  streamingData: z.object({
    formats: lenientArray(streamFormatSchema).optional(),
    adaptiveFormats: lenientArray(streamFormatSchema).optional(),
    serverAbrStreamingUrl: z.string().optional()
  }).optional(),
  playerConfig: z.object({
    mediaCommonConfig: z.object({
      mediaUstreamerRequestConfig: z.object({ videoPlaybackUstreamerConfig: z.string().optional() }).optional()
    }).optional()
  }).optional(),
  captions: z.object({
    playerCaptionsTracklistRenderer: z.object({ captionTracks: lenientArray(captionTrackSchema).optional() }).optional()
  }).optional()
});

export const pageResultSchema = z.object({
  error: z.string().optional(),
  playlist: z.object({
    title: z.string(),
    entries: z.array(
      z.object({
        videoId: z.string(),
        title: z.string()
      })
    )
  }).optional(),
  chapters: z.array(
    z.object({
      title: z.string(),
      start: z.number()
    })
  ).optional(),
  player: z.object({
    playerResponse: z.unknown(),
    requests: z.array(
      z.object({
        url: z.string(),
        body: z.string()
      })
    ),
    captionTexts: z.record(z.string(), z.string())
  }).optional()
});

export type StreamFormat = z.infer<typeof streamFormatSchema>;
export type Thumbnail = z.infer<typeof thumbnailSchema>;
export type PageResult = z.infer<typeof pageResultSchema>;
