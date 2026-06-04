import type { Prettify } from "./prettify";
import type { PlayabilityStatus } from "./youtube-format-enums";
import type { FormatItem, AdaptiveFormatItem, CaptionTrack, TranslationLanguage } from "./youtube-format-types";

/** @see https://github.com/LuanRT/YouTube.js/blob/main/src/parser/types/ParsedResponse.ts */
export type PlayerResponse = Prettify<{
  playabilityStatus: {
    status: `${PlayabilityStatus}`;
    reason?: string;
    messages?: string[];
  };
  videoDetails?: {
    videoId: string;
    title: string;
    lengthSeconds: `${number}`;
    channelId: string;
    shortDescription: string;
    keywords?: string[];
    thumbnail: {
      thumbnails: {
        url: string;
        width: number;
        height: number;
      }[];
    };
    viewCount: `${number}`;
    author: string;
    isPrivate: boolean;
    isLiveContent?: boolean;
    isLive?: boolean;
    allowRatings: boolean;
  };
  microformat?: {
    playerMicroformatRenderer: {
      liveBroadcastDetails?: {
        isLiveNow: true;
        startTimestamp: string;
      };
      title: { simpleText: string };
      description: { simpleText: string };
      lengthSeconds: `${number}`;
      category: string;
      publishDate: `${number}-${number}-${number}`;
      ownerChannelName: string;
    };
  };
  streamingData?: {
    expiresInSeconds: `${number}`;
    formats: FormatItem[];
    adaptiveFormats: AdaptiveFormatItem[];
    serverAbrStreamingUrl?: string;
  };
  playerConfig?: {
    mediaCommonConfig?: {
      mediaUstreamerRequestConfig?: {
        videoPlaybackUstreamerConfig?: string;
      };
    };
    [key: string]: unknown;
  };
  captions?: {
    playerCaptionsTracklistRenderer: {
      captionTracks: CaptionTrack[];
      translationLanguages?: TranslationLanguage[];
    };
  };
}>;
