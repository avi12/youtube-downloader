import { getMimeTypeForExtension, getOutputExtension, resolveAutoExtension } from "./mime-extension";
import { DownloadType } from "@/types";
import type { Options, VideoData } from "@/types";

export {
  AUTO_EXTENSION, AUTO_EXTENSION_LABEL,
  audioContainers, videoContainers, supportedExtensions,
  resolveAutoExtension, getOutputExtension
} from "./mime-extension";

export function getCompatibleFilename(filename: string) {
  return filename.replaceAll(/[<>:"\\/|?*`]/g, "");
}

export function getFileExtension(filename: string) {
  const iDot = filename.lastIndexOf(".");
  if (iDot === -1) {
    return "";
  }

  return filename.slice(iDot + 1);
}

export function splitFilenameAndExtension(filename: string) {
  const iDot = filename.lastIndexOf(".");
  if (iDot === -1) {
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

export function getMimeType(filename: string) {
  return getMimeTypeForExtension(getFileExtension(filename));
}

export function resolveVideoFilename({ videoData, options, titleOverride }: {
  videoData: VideoData;
  options: Options;
  titleOverride?: string;
}) {
  const [videoFormat = null] = videoData.videoFormats;
  const [audioFormat = null] = videoData.audioFormats;
  const extPref = videoData.isMusic ? options.ext.audio : options.ext.video;
  const defaultFormat = videoData.isMusic ? audioFormat : videoFormat;
  const resolvedExtension = resolveAutoExtension({
    extension: extPref,
    mimeType: defaultFormat?.mimeType ?? "",
    type: videoData.isMusic ? DownloadType.Audio : DownloadType.Video
  });
  const outputExtension = videoFormat && audioFormat && !videoData.isMusic
    ? getOutputExtension({
      videoMimeType: videoFormat.mimeType,
      audioMimeType: audioFormat.mimeType,
      userExtension: resolvedExtension
    })
    : resolvedExtension;
  const title = titleOverride ?? videoData.title;
  return getCompatibleFilename(`${title}.${outputExtension}`);
}
