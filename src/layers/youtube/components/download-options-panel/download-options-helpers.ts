import {
  audioContainers,
  buildFormatGroups,
  flattenFormatGroups,
  MULTI_TRACK_UNSUPPORTED_EXTENSIONS,
  splitFilenameAndExtension,
  supportedExtensions,
  videoContainers
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

type FormatItemsType = typeof DownloadType.Video | typeof DownloadType.Audio;

export function buildFormatItems(type: FormatItemsType, isMultiTrack = false) {
  const allowedExtensions = type === DownloadType.Video ? videoContainers : audioContainers;
  const excludedExtensions = isMultiTrack ? MULTI_TRACK_UNSUPPORTED_EXTENSIONS : undefined;
  const groups = buildFormatGroups({
    allowedExtensions,
    excludedExtensions
  });
  return flattenFormatGroups(groups).map(item => ({
    ext: item.extension,
    desc: item.description,
    isExcluded: item.isExcluded
  }));
}

export function getFilenameError({
  value,
  type,
  isMultiTrack = false
}: {
  value: string;
  type: FormatItemsType;
  isMultiTrack?: boolean;
}) {
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
    return `${fileExtension.toUpperCase()} doesn't support multiple audio tracks`;
  }

  if (!validExtensions.includes(fileExtension)) {
    return `Extension .${fileExtension} isn't supported for ${type}`;
  }

  return "";
}
