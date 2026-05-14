import { splitFilenameAndExtension, supportedExtensions } from "@/lib/utils/containers";
import { DownloadType } from "@/types";

export { buildQualityOptions, handleQualityChange } from "./quality-change-handler";
export { buildUniqueAudioLanguages, byLabel, resolveCaptionOriginalLabel } from "./audio-language-helpers";

export const DOWNLOAD_TYPES: {
  value: DownloadType;
  label: string;
}[] = [
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
];

export function getFilenameError({
  value,
  type
}: {
  value: string;
  type: typeof DownloadType.Video | typeof DownloadType.Audio;
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
  if (!ext) {
    return "Filename needs a file extension";
  }

  const validExtensions = supportedExtensions[type];
  if (!validExtensions.includes(ext)) {
    return `Extension .${ext} isn't supported for ${type} - try ${validExtensions.join(", ")}`;
  }

  return "";
}
