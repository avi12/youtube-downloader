import { formatVideoCodecLabel } from "@/lib/utils/container-specs";
import { alignVideoFormatToExtension, resolveVideoFormatVariants } from "@/lib/youtube/align-formats-to-container";
import { formatAudioCodecLabel, formatVideoQualityLabel } from "@/lib/youtube/video-helpers";
import type { AdaptiveFormatItem, VideoData } from "@/types";

const BITS_PER_KILOBIT = 1000;

export function buildQualityOptions({
  isAudio,
  audioFormats,
  videoFormats,
  videoFormatVariants,
  targetExtension,
  selectedAudioTrackId,
  uniqueAudioLanguagesCount
}: {
  isAudio: boolean;
  audioFormats: AdaptiveFormatItem[];
  videoFormats: AdaptiveFormatItem[];
  videoFormatVariants: VideoData["videoFormatVariants"];
  targetExtension: string;
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

  const variants = resolveVideoFormatVariants({
    videoFormats,
    videoFormatVariants
  });
  return videoFormats.map(format => {
    const downloadedFormat = alignVideoFormatToExtension({
      videoFormatVariants: variants,
      currentFormat: format,
      targetExtension
    });
    return {
      value: format.itag.toString(),
      label: `${formatVideoQualityLabel(format)} · ${formatVideoCodecLabel(downloadedFormat.mimeType)}`
    };
  });
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
