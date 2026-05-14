import { splitFilenameAndExtension, supportedExtensions } from "@/lib/utils/containers";
import {
  findOriginalAudioFormat,
  formatAudioCodecLabel,
  formatVideoQualityLabel,
  normalizeLanguageCode
} from "@/lib/youtube/video-helpers";
import { DownloadType } from "@/types";
import type { AdaptiveFormatItem, CaptionTrack } from "@/types";

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

export function buildUniqueAudioLanguages(audioFormats: AdaptiveFormatItem[]) {
  const seen = new Set<string>();
  const result: {
    value: string;
    label: string;
  }[] = [];
  for (const format of audioFormats) {
    if (!format.audioTrack) {
      continue;
    }

    const langCode = normalizeLanguageCode(format.audioTrack.id);
    if (seen.has(langCode)) {
      continue;
    }

    seen.add(langCode);
    result.push({
      value: langCode,
      label: format.audioTrack.displayName
    });
  }

  return result.toSorted(byLabel);
}

export function buildQualityOptions(
  isAudio: boolean,
  audioFormats: AdaptiveFormatItem[],
  videoFormats: AdaptiveFormatItem[],
  selectedAudioTrackId: string | null | undefined,
  uniqueAudioLanguagesCount: number
) {
  if (isAudio) {
    const trackId = selectedAudioTrackId ?? null;
    const formats = uniqueAudioLanguagesCount > 0
      ? audioFormats.filter(format => (format.audioTrack?.id ?? null) === trackId)
      : audioFormats;
    return formats.map(format => ({
      value: `${format.itag}:${format.audioTrack?.id ?? ""}`,
      label: `${Math.floor(format.bitrate / 1000)} kbps (${formatAudioCodecLabel(format.mimeType)})`
    }));
  }

  return videoFormats.map(format => ({
    value: format.itag.toString(),
    label: formatVideoQualityLabel(format)
  }));
}

export function resolveCaptionOriginalLabel(
  audioFormats: AdaptiveFormatItem[],
  captionTracks: CaptionTrack[]
): string | null {
  const originalLangId = findOriginalAudioFormat(audioFormats)?.audioTrack?.id;
  if (originalLangId) {
    const langCode = normalizeLanguageCode(originalLangId);
    const match =
      captionTracks.find(track => normalizeLanguageCode(track.languageCode) === langCode && !track.kind)
      ?? captionTracks.find(track => normalizeLanguageCode(track.languageCode) === langCode);
    if (match) {
      return match.name.simpleText;
    }
  }

  return captionTracks.find(track => !track.kind)?.name.simpleText
    ?? captionTracks[0]?.name.simpleText
    ?? null;
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
