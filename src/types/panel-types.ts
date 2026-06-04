import type { Prettify } from "./prettify";

export type LabeledOption<V = string> = {
  value: V;
  label: string;
  disabled?: boolean;
};

export const TrackKind = {
  Audio: "audio",
  Captions: "captions"
} as const;

export type TrackKind = (typeof TrackKind)[keyof typeof TrackKind];

export const PanelTrackMode = {
  MatchVideo: "follow",
  Original: "original",
  Custom: "custom"
} as const;

export type PanelTrackMode = (typeof PanelTrackMode)[keyof typeof PanelTrackMode];

export const StreamType = {
  Video: "video",
  Audio: "audio"
} as const;

export type StreamType = (typeof StreamType)[keyof typeof StreamType];

export const AUDIO_EXTRA_STREAM_PREFIX = "audio-extra";

export const ChipStyle = {
  Default: "STYLE_DEFAULT",
  AiCustomizedFeedChip: "STYLE_AI_CUSTOMIZED_FEED_CHIP",
  ExploreLauncherChip: "STYLE_EXPLORE_LAUNCHER_CHIP"
} as const;

export type ChipData = Prettify<{
  text: {
    simpleText: string;
  };
  style: {
    styleType: (typeof ChipStyle)[keyof typeof ChipStyle];
  };
  isSelected: boolean;
  navigationEndpoint?: {
    clickTrackingParams?: string;
    browseEndpoint?: {
      browseId: string;
      params?: string;
    };
  };
  trackingParams?: string;
  accessibilityData?: {
    accessibilityData: {
      label: string;
    };
  };
}>;
