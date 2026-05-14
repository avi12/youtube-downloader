import { getOutputExtension } from "./container-specs";
import { resolveAutoExtension } from "./mime-types";
import type { Options, VideoData } from "@/types";

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

export function resolveVideoFilename({ videoData, options, titleOverride }: {
  videoData: VideoData;
  options: Options;
  titleOverride?: string;
}) {
  const [videoFormat = null] = videoData.videoFormats;
  const [audioFormat = null] = videoData.audioFormats;
  const extensionPreference = videoData.isMusic ? options.ext.audio : options.ext.video;
  const defaultFormat = videoData.isMusic ? audioFormat : videoFormat;
  const resolvedExtension = resolveAutoExtension({
    extension: extensionPreference,
    mimeType: defaultFormat?.mimeType ?? ""
  });
  const outputExtension = videoFormat && audioFormat && !videoData.isMusic
    ? getOutputExtension({
      videoMimeType: videoFormat.mimeType,
      audioMimeType: audioFormat.mimeType,
      userExtension: resolvedExtension
    })
    : resolvedExtension;
  const rawTitle = titleOverride || videoData.title;
  const title = getCompatibleFilename(rawTitle).trim() || videoData.videoId;
  return `${title}.${outputExtension}`;
}
