import { getPreferredMusicAudioFormat } from "./panel-init-audio";
import { getCompatibleFilename, hasVisibleContent, resolveAutoExtension } from "@/lib/utils/containers";
import { DownloadType, type Options, type VideoData } from "@/types";

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

export function resolveInitialDownloadType({ options, videoData }: {
  options: Options;
  videoData: VideoData;
}) {
  const isExplicitType = options.defaultDownloadType !== DownloadType.Auto;
  if (isExplicitType) {
    return options.defaultDownloadType;
  }

  return videoData.isMusic ? DownloadType.Audio : DownloadType.VideoAndAudio;
}

export function resolveInitialExtension({ options, videoData }: {
  options: Options;
  videoData: VideoData;
}) {
  const extensionPreference = videoData.isMusic ? options.ext.audio : options.ext.video;
  const defaultFormat = videoData.isMusic
    ? getPreferredMusicAudioFormat(videoData.audioFormats)
    : videoData.videoFormats[0];
  return resolveAutoExtension({
    extension: extensionPreference,
    mimeType: defaultFormat?.mimeType ?? ""
  });
}

export function resolveInitialFilename(videoData: VideoData) {
  const sanitized = getCompatibleFilename(videoData.title).trim();
  return hasVisibleContent(sanitized) ? sanitized : videoData.videoId;
}
