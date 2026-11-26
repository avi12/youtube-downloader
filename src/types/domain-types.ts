import { DownloadType, type ProgressType } from "./download-enums";
import type { Prettify } from "./prettify";
import {
  codecPreferencesSchema,
  type SabrConfig,
  sabrConfigSchema,
  type SubtitleTrack,
  type VideoMetadata,
  videoMetadataSchema
} from "./settings-types";
import { adaptiveFormatSchema, captionTrackSchema, translationLanguageSchema } from "./youtube-format-types";
import { playerResponseSchema } from "./youtube-player-response";
import { z } from "@/lib/zod";
import { tolerated, uncheckedArray } from "@/lib/zod-guard";

export type DownloadProgressEntry = Prettify<{
  isDownloading: boolean;
  isDone: boolean;
  progress: number;
  progressType: ProgressType | "";
  isFailed?: boolean;
  isUnavailable?: boolean;
  videoItag?: number;
  audioItag?: number;
  downloadType?: DownloadType;
  downloadedBytes?: number;
  totalBytes?: number;
  bytesPerSecond?: number;
}>;

export const downloadRequestSchema = z.looseObject({
  type: z.enum(DownloadType),
  videoId: z.string(),
  videoItag: z.number(),
  audioItag: z.number(),
  audioTrackId: tolerated(z.string()),
  codecPreferences: tolerated(codecPreferencesSchema),
  selectedCaptionVssId: tolerated(z.string()),
  filenameOutput: z.string(),
  sabrConfig: tolerated(sabrConfigSchema.nullable()),
  downloadExtras: tolerated(z.boolean()),
  downloadExtraCaptions: tolerated(z.boolean()),
  includeAutoDubbing: tolerated(z.boolean()),
  isIframeFallback: tolerated(z.boolean()),
  isDefaultFormat: tolerated(z.boolean()),
  playlistId: tolerated(z.string()),
  playlistTitle: tolerated(z.string()),
  playlistTotalCount: tolerated(z.number()),
  poToken: tolerated(z.string()),
  sabrUrl: tolerated(z.string()),
  videoFormat: tolerated(adaptiveFormatSchema.nullable()),
  audioFormat: tolerated(adaptiveFormatSchema.nullable()),
  additionalAudioFormats: tolerated(z.array(adaptiveFormatSchema)),
  primaryAudioLabel: tolerated(z.string()),
  primaryAudioLanguageCode: tolerated(z.string()),
  captionTracks: tolerated(z.array(captionTrackSchema)),
  captionVttData: tolerated(z.array(z.string().nullable())),
  metadata: tolerated(videoMetadataSchema.nullable()),
  resolvedVideoUrl: tolerated(z.string().nullable()),
  resolvedAudioUrl: tolerated(z.string().nullable()),
  resolvedExtraAudioUrls: tolerated(z.array(z.string().nullable())),
  progressiveUrl: tolerated(z.string().nullable()),
  originTabId: tolerated(z.number()),
  sourceUrl: tolerated(z.string())
});

export type DownloadRequest = Prettify<z.infer<typeof downloadRequestSchema>>;

export type StreamData = Prettify<{
  type: DownloadType;
  videoId: string;
  filenameOutput: string;
  videoData: Uint8Array | null;
  videoFile?: File;
  audioData: Uint8Array | null;
  videoMimeType: string;
  audioMimeType: string;
  primaryAudioLabel?: string;
  primaryAudioLanguageCode?: string;
  additionalAudioStreams: {
    data: Uint8Array | null;
    mimeType: string;
    label: string;
    languageCode?: string;
  }[];
  subtitleTracks: SubtitleTrack[];
}>;

export type ProcessStreamData = Prettify<StreamData & {
  tabId: number;
  playlistId?: string;
  playlistTitle?: string;
  playlistTotalCount?: number;
  defaultAudioTrackIndex?: number;
  metadata?: VideoMetadata | null;
  quality?: string;
  sourceUrl?: string;
}>;

export const videoDataSchema = z.looseObject({
  // The panel payload drops it to keep the cross-world message small
  playerResponse: tolerated(playerResponseSchema),
  videoId: z.string(),
  title: z.string(),
  isMusic: z.boolean(),
  isDownloadable: z.boolean(),
  isLive: z.boolean(),
  videoFormats: uncheckedArray(adaptiveFormatSchema),
  // Every codec variant per height; videoFormats keeps one per height for the quality list
  videoFormatVariants: tolerated(z.array(adaptiveFormatSchema)),
  audioFormats: uncheckedArray(adaptiveFormatSchema),
  captionTracks: uncheckedArray(captionTrackSchema),
  sourceCaptionLanguageCode: tolerated(z.string()),
  translationLanguages: uncheckedArray(translationLanguageSchema),
  sabrConfig: z.custom<SabrConfig | null>(value => typeof value === "object"),
  progressiveUrl: z.string().nullable()
});

export type VideoData = Prettify<z.infer<typeof videoDataSchema>>;
