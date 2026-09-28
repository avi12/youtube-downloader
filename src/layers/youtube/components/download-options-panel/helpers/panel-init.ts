import { getPreferredMusicAudioFormat } from "./panel-init-audio";
import { getCompatibleFilename, hasVisibleContent, resolveAutoExtension } from "@/lib/utils/containers";
import { filterVideoFormatsByEnhancedBitrate } from "@/lib/youtube/format-display";
import { DownloadType, type Options, type Prettify, type VideoData } from "@/types";

export { IS_WATCH_PAGE } from "./panel-init-audio";
export {
  getPreferredMusicAudioFormat,
  resolveInitialAudioCustomLanguage,
  resolveInitialAudioFormat,
  resolveInitialAudioMode
} from "./panel-init-audio";
export {
  getActivePlayerCaption,
  resolveInitialCaptionMode,
  resolveInitialCaptionTrack
} from "./panel-init-caption";

type OptionsVideoDataParams = Prettify<{
  options: Options;
  videoData: VideoData;
}>;
export function resolveInitialDownloadType({ options, videoData }: OptionsVideoDataParams) {
  const isExplicitType = options.defaultDownloadType !== DownloadType.Auto;
  if (isExplicitType) {
    return options.defaultDownloadType;
  }

  return videoData.isMusic ? DownloadType.Audio : DownloadType.VideoAndAudio;
}

export function resolveInitialExtension({ options, videoData }: OptionsVideoDataParams) {
  if (videoData.isMusic) {
    const defaultFormat = getPreferredMusicAudioFormat(videoData.audioFormats);
    return resolveAutoExtension({
      extension: options.ext.audio,
      mimeType: defaultFormat?.mimeType ?? "",
      isAudio: true
    });
  }

  const candidates = filterVideoFormatsByEnhancedBitrate(videoData.videoFormats, options.enhancedBitrate);
  const defaultFormat = candidates[0];
  return resolveAutoExtension({
    extension: options.ext.video,
    mimeType: defaultFormat?.mimeType ?? ""
  });
}

export function resolveInitialFilename(videoData: VideoData) {
  const sanitized = getCompatibleFilename(videoData.title).trim();
  return hasVisibleContent(sanitized) ? sanitized : videoData.videoId;
}
