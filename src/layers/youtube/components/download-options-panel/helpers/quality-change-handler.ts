import { groupChoices, uniqueChoices, type Choice } from "@/lib/utils/choices";
import {
  describeAudioCodec,
  describeVideoCodec,
  formatAudioCodecLabel,
  formatVideoCodecLabel,
  isAudioMimeNativeForContainer,
  isVideoAllowedInContainer
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

type FormatCondition<Params> = (format: AdaptiveFormatItem, params: Params) => boolean;

// The container holds the stream as-is instead of the download switching to MKV
function isVideoHeldByContainer(format: AdaptiveFormatItem, { targetExtension }: VideoOptionsParams) {
  return isVideoAllowedInContainer({
    videoMimeType: format.mimeType,
    targetExtension
  });
}

// The plan downloads exactly this variant once it's picked by hand
function isVideoKeptByPlan(format: AdaptiveFormatItem, params: VideoOptionsParams) {
  return alignVideoFormatToExtension({
    ...params,
    currentFormat: format,
    codecPreferences: pinVideoCodecPreferences({
      codecPreferences: params.codecPreferences,
      videoFormat: format
    })
  }) === format;
}

// A codec variant is offered only when it meets every condition. The variants are what YouTube
// serves for this video, which already carries per-codec limits (H.264 stops at 1080p except on
// 360° videos, HDR only on HDR uploads, AV1 only on some); further rules go in this list
const VIDEO_FORMAT_CONDITIONS: FormatCondition<VideoOptionsParams>[] = [isVideoHeldByContainer, isVideoKeptByPlan];

function listOfferedVideoFormats(params: VideoOptionsParams) {
  return params.videoFormatVariants.filter(format =>
    VIDEO_FORMAT_CONDITIONS.every(isConditionMet => isConditionMet(format, params)));
}

// One row per resolution; each row's value is the variant the current codec choice downloads.
// Variants arrive sorted by byQualityDesc, so the first one per resolution is its best
export function buildVideoQualityOptions(params: VideoOptionsParams) {
  return uniqueChoices(
    listOfferedVideoFormats(params).map(format => ({
      value: alignVideoFormatToExtension({
        ...params,
        currentFormat: format
      }).itag.toString(),
      label: formatVideoQualityLabel(format)
    }))
  );
}

// The codecs offered for the quality being downloaded, each with what it's good for
export function buildVideoCodecOptions({ downloadedFormat, ...params }: VideoOptionsParams & {
  downloadedFormat: AdaptiveFormatItem;
}) {
  const qualityLabel = formatVideoQualityLabel(downloadedFormat);
  return uniqueChoices(
    listOfferedVideoFormats(params)
      .filter(format => formatVideoQualityLabel(format) === qualityLabel)
      .map(format => ({
        value: format.itag.toString(),
        label: formatVideoCodecLabel(format.mimeType),
        description: describeVideoCodec(format.mimeType)
      }))
  );
}

type AudioOptionsParams = Prettify<{
  audioFormats: AdaptiveFormatItem[];
  targetExtension: string;
  codecPreferences: CodecPreferences;
}>;

function isAudioHeldByContainer(format: AdaptiveFormatItem, { targetExtension }: AudioOptionsParams) {
  return isAudioMimeNativeForContainer({
    audioMimeType: format.mimeType,
    targetExtension
  });
}

function isAudioKeptByPlan(format: AdaptiveFormatItem, params: AudioOptionsParams) {
  return alignAudioFormatToExtension({
    ...params,
    currentFormat: format,
    codecPreferences: pinAudioCodecPreferences({
      codecPreferences: params.codecPreferences,
      audioFormat: format
    })
  }) === format;
}

// Same idea as the video conditions: Dolby only shows on videos that carry it, and only for
// containers that hold it (MP4/MKV, not WebM)
const AUDIO_FORMAT_CONDITIONS: FormatCondition<AudioOptionsParams>[] = [isAudioHeldByContainer, isAudioKeptByPlan];

// Audio for a video download
export function buildMuxedAudioOptions({
  selectedAudioTrackId, uniqueAudioLanguagesCount, ...params
}: AudioOptionsParams & {
  selectedAudioTrackId: string | null | undefined;
  uniqueAudioLanguagesCount: number;
}) {
  const options = filterSelectedTrack({
    audioFormats: params.audioFormats,
    selectedAudioTrackId,
    uniqueAudioLanguagesCount
  })
    .filter(format => AUDIO_FORMAT_CONDITIONS.every(isConditionMet => isConditionMet(format, params)))
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
