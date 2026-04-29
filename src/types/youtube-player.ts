import type { AdaptiveFormatItem, FormatItem, PlayabilityStatus } from "./youtube-formats";

export type CaptionTrack = {
  baseUrl: string;
  name: { simpleText: string };
  languageCode: string;
  kind?: string;
};

export type PlayerResponse = {
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
    };
  };
};
