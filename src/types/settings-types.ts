import {
  AudioCodecPreference,
  type AudioTrackLanguageMode,
  type CaptionLanguageMode,
  type DownloadType,
  DynamicRangePreference,
  type MaxFrameRate,
  type PlaylistDownloadMode,
  type PlaylistOutputMode,
  VideoCodecPreference,
  type VideoQualityMode
} from "./download-enums";
import type { Prettify } from "./prettify";
import { adaptiveFormatSchema } from "./youtube-format-types";
import { z } from "@/lib/zod";
import { tolerated, uncheckedArray } from "@/lib/zod-guard";

export type VideoTabParams = Prettify<{
  videoId: string;
  tabId: number;
}>;

export const sabrConfigSchema = z.looseObject({
  serverAbrStreamingUrl: z.string(),
  videoPlaybackUstreamerConfig: z.string(),
  clientName: z.number(),
  clientVersion: z.string(),
  formats: uncheckedArray(adaptiveFormatSchema)
});

export type SabrConfig = Prettify<z.infer<typeof sabrConfigSchema>>;

export type SubtitleTrack = Prettify<{
  data: Uint8Array | null;
  label: string;
  languageCode: string;
}>;

// Only what names the file is required: the rest is optional tagging that must never fail a download
export const videoMetadataSchema = z.looseObject({
  title: z.string(),
  artist: z.string(),
  albumArtist: tolerated(z.string()),
  album: tolerated(z.string()),
  genres: tolerated(z.array(z.string())),
  date: tolerated(z.string()),
  thumbnailUrl: tolerated(z.string()),
  lengthSeconds: tolerated(z.number()),
  isMusic: z.boolean()
});

export type VideoMetadata = Prettify<z.infer<typeof videoMetadataSchema>>;

export type DownloadTypePreference = DownloadType;

export const codecPreferencesSchema = z.looseObject({
  videoCodec: z.enum(VideoCodecPreference),
  audioCodec: z.enum(AudioCodecPreference),
  dynamicRange: z.enum(DynamicRangePreference)
});

export type CodecPreferences = Prettify<z.infer<typeof codecPreferencesSchema>>;

export type Options = Prettify<{
  ext: {
    audio: string;
    video: string;
  };
  defaultDownloadType: DownloadTypePreference;
  videoQualityMode: VideoQualityMode;
  videoQuality: number;
  maxFrameRate: MaxFrameRate;
  enhancedBitrate: boolean;
  videoCodec: VideoCodecPreference;
  audioCodec: AudioCodecPreference;
  dynamicRange: DynamicRangePreference;
  isShowNativeDownload: boolean;
  isShowGridDownloadButtons: boolean;
  isNotifyOnIdle: boolean;
  isRevealOnComplete: boolean;
  playlistDownloadMode: PlaylistDownloadMode;
  playlistOutputMode: PlaylistOutputMode;
  playlistAudioOutputMode: PlaylistOutputMode;
  isPlaylistScrollSyncEnabled: boolean;
  audioTrackLanguageMode: AudioTrackLanguageMode;
  captionLanguageMode: CaptionLanguageMode;
  customLanguage: string;
  downloadExtras: boolean;
  includeAutoDubbing: boolean;
  includeAiCaptions: boolean;
}>;
