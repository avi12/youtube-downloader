import { groupChoices, uniqueChoices, type Choice } from "@/lib/utils/choices";
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
import type { AdaptiveFormatItem, CodecPreferences, Prettify } from "@/types";

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

type VideoOptionsParams = Prettify<{
  videoFormatVariants: AdaptiveFormatItem[];
  targetExtension: string;
  codecPreferences: CodecPreferences;
}>;

// Variants the plan keeps as-is once picked by hand, so what's listed is what downloads
function listKeptVideoFormats({ videoFormatVariants, targetExtension, codecPreferences }: VideoOptionsParams) {
  return videoFormatVariants.filter(format => alignVideoFormatToExtension({
    videoFormatVariants,
    currentFormat: format,
    targetExtension,
    codecPreferences: pinVideoCodecPreferences({
      codecPreferences,
      videoFormat: format
    })
  }) === format);
}

// One row per resolution; each row's value is the variant the current codec choice downloads.
// Variants arrive sorted by byQualityDesc, so the first one per resolution is its best
export function buildVideoQualityOptions(params: VideoOptionsParams) {
  return uniqueChoices(
    listKeptVideoFormats(params).map(format => ({
      value: alignVideoFormatToExtension({
        ...params,
        currentFormat: format
      }).itag.toString(),
      label: formatVideoQualityLabel(format)
    }))
  );
}

// The codecs offered at the resolution being downloaded, each with what it's good for
export function buildVideoCodecOptions({ downloadedFormat, ...params }: VideoOptionsParams & {
  downloadedFormat: AdaptiveFormatItem;
}) {
  const qualityLabel = formatVideoQualityLabel(downloadedFormat);
  return uniqueChoices(
    listKeptVideoFormats(params)
      .filter(format => formatVideoQualityLabel(format) === qualityLabel)
      .map(format => ({
        value: format.itag.toString(),
        label: formatVideoCodecLabel(format.mimeType),
        description: describeVideoCodec(format.mimeType)
      }))
  );
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
