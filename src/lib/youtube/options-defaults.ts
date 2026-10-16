import { AUTO_EXTENSION } from "@/lib/utils/containers";
import {
  AudioCodecPreference,
  AudioTrackLanguageMode,
  CaptionLanguageMode,
  DownloadType,
  DynamicRangePreference,
  MaxFrameRate,
  PlaylistDownloadMode,
  PlaylistOutputMode,
  VideoCodecPreference,
  VideoQualityMode
} from "@/types";
import type { Options } from "@/types";

export const VIDEO_QUALITIES = [4320, 2160, 1440, 1080, 720, 480, 360, 240, 144];

const DEFAULT_VIDEO_QUALITY = 1080;
const DEFAULT_VIDEO_EXTENSION = "mkv";
const DEFAULT_CUSTOM_LANGUAGE = "en";

export const INITIAL_OPTIONS: Options = {
  ext: {
    audio: AUTO_EXTENSION,
    video: DEFAULT_VIDEO_EXTENSION
  },
  defaultDownloadType: DownloadType.Auto,
  videoQualityMode: VideoQualityMode.Best,
  videoQuality: DEFAULT_VIDEO_QUALITY,
  maxFrameRate: MaxFrameRate.Any,
  enhancedBitrate: true,
  videoCodec: VideoCodecPreference.Auto,
  audioCodec: AudioCodecPreference.Auto,
  dynamicRange: DynamicRangePreference.Sdr,
  isShowNativeDownload: false,
  isShowGridDownloadButtons: true,
  isNotifyOnIdle: false,
  isRevealOnComplete: false,
  playlistDownloadMode: PlaylistDownloadMode.Fast,
  playlistOutputMode: PlaylistOutputMode.Individual,
  playlistAudioOutputMode: PlaylistOutputMode.Zip,
  isPlaylistScrollSyncEnabled: false,
  audioTrackLanguageMode: AudioTrackLanguageMode.MatchVideo,
  captionLanguageMode: CaptionLanguageMode.SameAsAudio,
  customLanguage: DEFAULT_CUSTOM_LANGUAGE,
  downloadExtras: true,
  includeAutoDubbing: false,
  includeAiCaptions: false
};
