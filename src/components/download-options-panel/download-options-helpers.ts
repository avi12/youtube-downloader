import { splitFilenameAndExtension, supportedExtensions } from "@/lib/utils/containers";
import { DownloadType } from "@/types";
import type { AdaptiveFormatItem } from "@/types";

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

export function byLabel(optA: { label: string }, optB: { label: string }) {
  return optA.label.localeCompare(optB.label);
}

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

export function handleQualityChange({
  valueString,
  isAudio,
  audioFormats,
  videoFormats,
  onaudioformatchange,
  onvideoformatchange
}: {
  valueString: string;
  isAudio: boolean;
  audioFormats: AdaptiveFormatItem[];
  videoFormats: AdaptiveFormatItem[];
  onaudioformatchange: (format: AdaptiveFormatItem) => void;
  onvideoformatchange: (format: AdaptiveFormatItem) => void;
}) {
  if (isAudio) {
    const colonIndex = valueString.indexOf(":");
    const itag = parseInt(valueString.slice(0, colonIndex), 10);
    const trackId = valueString.slice(colonIndex + 1) || undefined;
    const format = audioFormats.find(item => item.itag === itag && item.audioTrack?.id === trackId);
    if (format) {
      onaudioformatchange(format);
    }
  } else {
    const itag = parseInt(valueString, 10);
    const format = videoFormats.find(videoFormat => videoFormat.itag === itag);
    if (format) {
      onvideoformatchange(format);
    }
  }
}
