import { resolveOutputExtensionForFormats } from "@/lib/youtube/align-formats-to-container";
import { resolveAutoContainer } from "@/lib/youtube/auto-container";
import { DownloadType, type Options, type VideoData } from "@/types";

export function getCompatibleFilename(filename: string) {
  return filename.replaceAll(/[<>:"\\/|?*`]/g, "");
}

export function hasVisibleContent(filename: string) {
  return /[\p{L}\p{N}\p{P}\p{S}]/u.test(filename);
}

export function getFileExtension(filename: string) {
  const iDot = filename.lastIndexOf(".");
  const hasDot = iDot !== -1;
  if (!hasDot) {
    return "";
  }

  return filename.slice(iDot + 1);
}

export function splitFilenameAndExtension(filename: string) {
  const iDot = filename.lastIndexOf(".");
  const hasDot = iDot !== -1;
  if (!hasDot) {
    return {
      name: filename,
      extension: ""
    };
  }

  return {
    name: filename.slice(0, iDot),
    extension: filename.slice(iDot + 1)
  };
}

export function resolveVideoFilename({ videoData, options, downloadType, titleOverride }: {
  videoData: VideoData;
  options: Options;
  downloadType: DownloadType;
  titleOverride?: string;
}) {
  const [videoFormat = null] = videoData.videoFormats;
  const [audioFormat = null] = videoData.audioFormats;
  const isAudioDownload = downloadType === DownloadType.Audio;
  const extensionPreference = isAudioDownload ? options.ext.audio : options.ext.video;
  const defaultFormat = isAudioDownload ? audioFormat : videoFormat;
  const resolvedExtension = resolveAutoContainer({
    extension: extensionPreference,
    videoData,
    sourceMimeType: defaultFormat?.mimeType ?? "",
    codecPreferences: options,
    isAudio: isAudioDownload
  });
  const outputExtension = videoFormat && audioFormat && !isAudioDownload
    ? resolveOutputExtensionForFormats({
      videoData,
      videoFormat,
      audioFormat,
      userExtension: resolvedExtension,
      codecPreferences: options
    })
    : resolvedExtension;
  const rawTitle = titleOverride || videoData.title;
  const sanitized = getCompatibleFilename(rawTitle).trim();
  const title = hasVisibleContent(sanitized) ? sanitized : videoData.videoId;
  return `${title}.${outputExtension}`;
}
