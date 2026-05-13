import { AUTO_EXTENSION } from "@/lib/utils/containers";
import {
  AudioTrackLanguageMode,
  CaptionLanguageMode,
  DownloadType,
  PlaylistDownloadMode,
  PlaylistOutputMode,
  VideoQualityMode
} from "@/types";
import type { Options } from "@/types";

export const VIDEO_QUALITIES = [4320, 2160, 1440, 1080, 720, 480, 360, 240, 144];

const DEFAULT_VIDEO_QUALITY = 1080;

export const INITIAL_OPTIONS: Options = {
  ext: {
    audio: AUTO_EXTENSION,
    video: "mkv"
  },
  defaultDownloadType: DownloadType.Auto,
  videoQualityMode: VideoQualityMode.Best,
  videoQuality: DEFAULT_VIDEO_QUALITY,
  isShowNativeDownload: false,
  isNotifyOnIdle: false,
  isRevealOnComplete: false,
  playlistDownloadMode: PlaylistDownloadMode.Fast,
  playlistOutputMode: PlaylistOutputMode.Individual,
  playlistAudioOutputMode: PlaylistOutputMode.Zip,
  isPlaylistScrollSyncEnabled: false,
  audioTrackLanguageMode: AudioTrackLanguageMode.OriginalLanguage,
  captionLanguageMode: CaptionLanguageMode.SameAsAudio,
  customLanguage: "en",
  downloadExtras: true
};
