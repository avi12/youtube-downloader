import type { InnertubeContext, InnertubeContentPlaybackContext } from "./innertube-client";
import type { Prettify } from "@/types";

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

export type InnertubePlayerRequest = Prettify<{
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
}>;

export type InnertubeAttGetRequest = Prettify<{
  engagementType: InnertubeEngagementType;
  context: InnertubeContext;
  webPoSignalOutput?: string[];
  botguardData?: {
    interpreterHash?: string;
    botguardResponse?: string;
  };
}>;

export type InnertubeSearchRequest = Prettify<{
  query: string;
  context: InnertubeContext;
  params?: string;
  continuation?: string;
}>;

export type InnertubeGenerateItRequest = readonly [requestKey: string, snapshotResponse: string];

export type InnertubeGenerateItResponse = readonly [integrityToken: string, ...rest: unknown[]];

export type InnertubeBrowseRequest = Prettify<{
  browseId: `FE${string}` | `UC${string}` | `VL${string}` | `MPLA${string}` | `MPRE${string}` | (string & {});
  context: InnertubeContext;
  params?: string;
  continuation?: string;
  query?: string;
  formData?: {
    selectedValues?: string[];
  };
  inlineSettingsMenu?: boolean;
}>;
