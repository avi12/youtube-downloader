import {
  splitFilenameAndExtension,
  supportedExtensions,
  getFormatDescription,
  AUTO_EXTENSION,
  MULTI_TRACK_UNSUPPORTED_EXTENSIONS
} from "@/lib/utils/containers";
import { DownloadType } from "@/types";

export { buildQualityOptions, handleQualityChange } from "./helpers/quality-change-handler";
export { buildUniqueAudioLanguages, byLabel, resolveCaptionOriginalLabel } from "./helpers/audio-language-helpers";

export const DOWNLOAD_TYPES = [
  {
    value: DownloadType.VideoAndAudio,
    label: "Video + Audio"
  },
  {
    value: DownloadType.Video,
    label: "Video only"
  },
  {
    value: DownloadType.Audio,
    label: "Audio only"
  }
] as const;

export function buildFormatItems(
  type: typeof DownloadType.Video | typeof DownloadType.Audio,
  isMultiTrack = false
) {
  return supportedExtensions[type]
    .filter(extension => extension !== AUTO_EXTENSION)
    .map(extension => ({
      ext: extension,
      desc: getFormatDescription(extension),
      isExcluded: isMultiTrack && MULTI_TRACK_UNSUPPORTED_EXTENSIONS.has(extension)
    }));
}

export function getFilenameError({
  value,
  type,
  isMultiTrack = false
}: {
  value: string;
  type: typeof DownloadType.Video | typeof DownloadType.Audio;
  isMultiTrack?: boolean;
}) {
  const illegalMatch = value.match(/[<>:"/\\|?*]/);
  if (illegalMatch) {
    return `Character "${illegalMatch[0]}" isn't allowed in filenames`;
  }

  const { name, extension } = splitFilenameAndExtension(value);
  if (!name.trim()) {
    return "Filename can't be empty";
  }

  const fileExtension = extension.toLowerCase();
  const validExtensions = supportedExtensions[type];
  if (!fileExtension) {
    return "No extension - pick one below";
  }

  if (isMultiTrack && MULTI_TRACK_UNSUPPORTED_EXTENSIONS.has(fileExtension)) {
    return "AVI doesn't support multiple audio tracks";
  }

  if (!validExtensions.includes(fileExtension)) {
    return `Extension .${fileExtension} isn't supported for ${type}`;
  }

  return "";
}
