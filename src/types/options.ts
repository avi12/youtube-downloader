import type { DownloadTypePreference } from "./download";

export const VideoQualityMode = {
  Best: "best",
  CurrentQuality: "current-quality",
  Custom: "custom"
} as const;

export type VideoQualityMode = (typeof VideoQualityMode)[keyof typeof VideoQualityMode];

export const PlaylistDownloadMode = {
  Fast: "fast",
  DataSaver: "dataSaver"
} as const;

export type PlaylistDownloadMode = (typeof PlaylistDownloadMode)[keyof typeof PlaylistDownloadMode];

export const PlaylistOutputMode = {
  Individual: "individual",
  Zip: "zip"
} as const;

export type PlaylistOutputMode = (typeof PlaylistOutputMode)[keyof typeof PlaylistOutputMode];

export type Options = {
  ext: {
    audio: string;
    video: string;
  };
  defaultDownloadType: DownloadTypePreference;
  videoQualityMode: VideoQualityMode;
  videoQuality: number;
  isShowNativeDownload: boolean;
  playlistDownloadMode: PlaylistDownloadMode;
  playlistOutputMode: PlaylistOutputMode;
  playlistAudioOutputMode: PlaylistOutputMode;
  isPlaylistScrollSyncEnabled: boolean;
};
