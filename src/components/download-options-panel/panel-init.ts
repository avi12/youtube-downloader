import { getPreferredMusicAudioFormat } from "./panel-init-audio";
import { getCompatibleFilename, resolveAutoExtension } from "@/lib/utils/containers";
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

export function resolveInitialDownloadType(options: Options, videoData: VideoData) {
  if (options.defaultDownloadType !== DownloadType.Auto) {
    return options.defaultDownloadType;
  }

  return videoData.isMusic ? DownloadType.Audio : DownloadType.VideoAndAudio;
}

export function resolveInitialExtension(options: Options, videoData: VideoData) {
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
  return getCompatibleFilename(videoData.title || videoData.videoId);
}
