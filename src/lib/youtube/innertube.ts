import type { InnertubeContext, InnertubeContentPlaybackContext } from "./innertube-client";

export {
  InnertubeClientName,
  type InnertubeClientContext,
  type InnertubeContext,
  type InnertubeContentPlaybackContext
} from "./innertube-client";

export const InnertubeEngagementType = {
  Unbound: "ENGAGEMENT_TYPE_UNBOUND",
  Playback: "ENGAGEMENT_TYPE_PLAYBACK",
  VideoFrame: "ENGAGEMENT_TYPE_VIDEO_FRAME",
  Ad: "ENGAGEMENT_TYPE_AD"
} as const;

export type InnertubeEngagementType =
  | (typeof InnertubeEngagementType)[keyof typeof InnertubeEngagementType]
  | (string & {});

export interface InnertubePlayerRequest {
  videoId: string;
  context: InnertubeContext;
  playbackContext?: {
    contentPlaybackContext: InnertubeContentPlaybackContext;
  };
  contentCheckOk?: boolean;
  racyCheckOk?: boolean;
  cpn?: string;
  serviceIntegrityDimensions?: {
    poToken?: string;
  };
  attestationRequest?: {
    omitBotguardData?: boolean;
  };
  params?: string;
  playlistId?: string;
  startTimeSecs?: number;
}

export interface InnertubeAttGetRequest {
  engagementType: InnertubeEngagementType;
  context: InnertubeContext;
  webPoSignalOutput?: string[];
  botguardData?: {
    interpreterHash?: string;
    botguardResponse?: string;
  };
}

export interface InnertubeSearchRequest {
  query: string;
  context: InnertubeContext;
  params?: string;
  continuation?: string;
}

export type InnertubeGenerateItRequest = readonly [requestKey: string, snapshotResponse: string];

export type InnertubeGenerateItResponse = readonly [integrityToken: string, ...rest: unknown[]];

export interface InnertubeBrowseRequest {
  browseId: `FE${string}` | `UC${string}` | `VL${string}` | `MPLA${string}` | `MPRE${string}` | (string & {});
  context: InnertubeContext;
  params?: string;
  continuation?: string;
  query?: string;
  formData?: {
    selectedValues?: string[];
  };
  inlineSettingsMenu?: boolean;
}
