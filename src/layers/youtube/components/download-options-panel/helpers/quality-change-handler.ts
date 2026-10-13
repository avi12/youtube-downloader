import { formatChoiceLabel, groupChoices, type Choice } from "@/lib/utils/choices";
import {
  describeAudioCodec,
  describeVideoCodec,
  formatAudioCodecLabel,
  formatVideoCodecLabel
} from "@/lib/utils/container-specs";
import {
  alignVideoFormatToExtension,
  pinAudioCodecPreferences,
  pinVideoCodecPreferences
} from "@/lib/youtube/align-formats-to-container";
import {
  alignAudioFormatToExtension,
  formatAudioBitrateLabel,
  formatVideoQualityLabel
} from "@/lib/youtube/video-helpers";
import type { AdaptiveFormatItem, CodecPreferences } from "@/types";

export function toAudioFormatValue(format: AdaptiveFormatItem) {
  return `${format.itag}:${format.audioTrack?.id ?? ""}`;
}

export function findAudioFormatByValue({ audioFormats, valueString }: {
  audioFormats: AdaptiveFormatItem[];
  valueString: string;
}) {
  const colonIndex = valueString.indexOf(":");
  const itag = parseInt(valueString.slice(0, colonIndex), 10);
  const trackId = valueString.slice(colonIndex + 1) || undefined;
  return audioFormats.find(format => format.itag === itag && format.audioTrack?.id === trackId);
}

function filterSelectedTrack({ audioFormats, selectedAudioTrackId, uniqueAudioLanguagesCount }: {
  audioFormats: AdaptiveFormatItem[];
  selectedAudioTrackId: string | null | undefined;
  uniqueAudioLanguagesCount: number;
}) {
  const trackId = selectedAudioTrackId ?? null;
  return uniqueAudioLanguagesCount > 0
    ? audioFormats.filter(format => (format.audioTrack?.id ?? null) === trackId)
    : audioFormats;
}

// Rows are grouped under their codec, which carries the description once
function toAudioChoice(format: AdaptiveFormatItem): Choice {
  return {
    value: toAudioFormatValue(format),
    label: formatAudioBitrateLabel(format),
    group: {
      label: formatAudioCodecLabel(format.mimeType),
      description: describeAudioCodec(format.mimeType)
    }
  };
}

export function buildAudioFormatOptions(params: Parameters<typeof filterSelectedTrack>[0]) {
  return groupChoices(filterSelectedTrack(params).map(toAudioChoice));
}

// Each codec variant the container keeps as-is gets its own entry; a variant is listed only if
// the plan's alignment, given that variant's own codec, keeps it - so what's listed is what downloads
export function buildVideoQualityOptions({ videoFormatVariants, targetExtension, codecPreferences }: {
  videoFormatVariants: AdaptiveFormatItem[];
  targetExtension: string;
  codecPreferences: CodecPreferences;
}) {
  // Variants arrive sorted by byQualityDesc, so a repeated label (e.g. two 1080p AV1 itags)
  // keeps its higher-bitrate entry
  const seenLabels = new Set<string>();
  const options = videoFormatVariants
    .filter(format => alignVideoFormatToExtension({
      videoFormatVariants,
      currentFormat: format,
      targetExtension,
      codecPreferences: pinVideoCodecPreferences({
        codecPreferences,
        videoFormat: format
      })
    }) === format)
    .map((format): Choice => ({
      value: format.itag.toString(),
      label: formatVideoQualityLabel(format),
      group: {
        label: formatVideoCodecLabel(format.mimeType),
        description: describeVideoCodec(format.mimeType)
      }
    }))
    .filter(option => {
      const fullLabel = formatChoiceLabel(option);
      const isSeen = seenLabels.has(fullLabel);
      seenLabels.add(fullLabel);
      return !isSeen;
    });
  return groupChoices(options);
}

// Audio for a video download, filtered the same way as the video list
export function buildMuxedAudioOptions({ targetExtension, codecPreferences, ...trackParams }: {
  audioFormats: AdaptiveFormatItem[];
  selectedAudioTrackId: string | null | undefined;
  uniqueAudioLanguagesCount: number;
  targetExtension: string;
  codecPreferences: CodecPreferences;
}) {
  const options = filterSelectedTrack(trackParams)
    .filter(format => alignAudioFormatToExtension({
      audioFormats: trackParams.audioFormats,
      currentFormat: format,
      targetExtension,
      codecPreferences: pinAudioCodecPreferences({
        codecPreferences,
        audioFormat: format
      })
    }) === format)
    .map(toAudioChoice);
  return groupChoices(options);
}

export function handleQualityChange({
  valueString,
  isAudio,
  audioFormats,
  videoFormatVariants,
  onaudioformatchange,
  onvideoformatchange
}: {
  valueString: string;
  isAudio: boolean;
  audioFormats: AdaptiveFormatItem[];
  videoFormatVariants: AdaptiveFormatItem[];
  onaudioformatchange: (format: AdaptiveFormatItem) => void;
  onvideoformatchange: (format: AdaptiveFormatItem) => void;
}) {
  if (isAudio) {
    const format = findAudioFormatByValue({
      audioFormats,
      valueString
    });
    if (format) {
      onaudioformatchange(format);
    }

    return;
  }

  const itag = parseInt(valueString, 10);
  const format = videoFormatVariants.find(videoFormat => videoFormat.itag === itag);
  if (format) {
    onvideoformatchange(format);
  }
}
