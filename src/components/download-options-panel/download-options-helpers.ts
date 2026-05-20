import {
  splitFilenameAndExtension,
  supportedExtensions,
  getFormatDescription,
  AUTO_EXTENSION
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

const MULTI_TRACK_UNSUPPORTED_EXTENSIONS = new Set(["avi"]);

export function buildFormatItems(
  type: typeof DownloadType.Video | typeof DownloadType.Audio,
  isMultiTrack = false
) {
  return supportedExtensions[type]
    .filter(e => e !== AUTO_EXTENSION)
    .filter(e => !isMultiTrack || !MULTI_TRACK_UNSUPPORTED_EXTENSIONS.has(e))
    .map(e => ({
      ext: e,
      desc: getFormatDescription(e)
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

  const ext = extension.toLowerCase();
  const validExtensions = supportedExtensions[type];
  if (!ext) {
    return "No extension - pick one below";
  }

  if (isMultiTrack && MULTI_TRACK_UNSUPPORTED_EXTENSIONS.has(ext)) {
    return "AVI doesn't support multiple audio tracks";
  }

  if (!validExtensions.includes(ext)) {
    return `Extension .${ext} isn't supported for ${type}`;
  }

  return "";
}
