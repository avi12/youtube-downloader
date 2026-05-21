import { formatAudioCodecLabel, formatVideoQualityLabel } from "@/lib/youtube/video-helpers";
import type { AdaptiveFormatItem } from "@/types";

const BITS_PER_KILOBIT = 1000;

export function buildQualityOptions({
  isAudio,
  audioFormats,
  videoFormats,
  selectedAudioTrackId,
  uniqueAudioLanguagesCount
}: {
  isAudio: boolean;
  audioFormats: AdaptiveFormatItem[];
  videoFormats: AdaptiveFormatItem[];
  selectedAudioTrackId: string | null | undefined;
  uniqueAudioLanguagesCount: number;
}) {
  if (isAudio) {
    const trackId = selectedAudioTrackId ?? null;
    const formats = uniqueAudioLanguagesCount > 0
      ? audioFormats.filter(format => (format.audioTrack?.id ?? null) === trackId)
      : audioFormats;
    return formats.map(format => ({
      value: `${format.itag}:${format.audioTrack?.id ?? ""}`,
      label: `${Math.floor(format.bitrate / BITS_PER_KILOBIT)} kbps (${formatAudioCodecLabel(format.mimeType)})`
    }));
  }

  return videoFormats.map(format => ({
    value: format.itag.toString(),
    label: formatVideoQualityLabel(format)
  }));
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

    return;
  }

  const itag = parseInt(valueString, 10);
  const format = videoFormats.find(videoFormat => videoFormat.itag === itag);
  if (format) {
    onvideoformatchange(format);
  }
}
