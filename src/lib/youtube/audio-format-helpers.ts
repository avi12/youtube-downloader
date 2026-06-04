import { DownloadType } from "@/types";
import type { AdaptiveFormatItem, Prettify } from "@/types";

const AUDIO_TRACK_ORIGINAL_SUFFIX = ".4";
const AUDIO_TRACK_ORIGINAL_LABEL = "(original)";
const VIDEO_SELECTOR = "video.html5-main-video";
const BITS_PER_KBPS = 1000;
const CODEC_PATTERN = /codecs="?([^";]+)"?/;

export function getAudioCodecLabel(mimeType: string) {
  const codec = mimeType.match(CODEC_PATTERN)?.[1]?.toLowerCase() ?? "";
  if (codec.startsWith("mp4a")) {
    return "AAC";
  }

  if (codec.startsWith("opus")) {
    return "Opus";
  }

  if (codec.startsWith("vorbis")) {
    return "Vorbis";
  }

  if (codec.startsWith("ec-3")) {
    return "E-AC-3";
  }

  if (codec.startsWith("ac-3")) {
    return "AC-3";
  }

  return codec.toUpperCase();
}

export function getAudioQualityLabel(format: AdaptiveFormatItem) {
  const codec = getAudioCodecLabel(format.mimeType);
  const bitsPerSecond = format.averageBitrate || format.bitrate;
  const kbps = bitsPerSecond ? Math.round(bitsPerSecond / BITS_PER_KBPS) : 0;
  if (codec && kbps) {
    return `${kbps} kbps · ${codec}`;
  }

  return kbps ? `${kbps} kbps` : codec;
}

type ResolveQualityLabelParams = Prettify<{
  type: DownloadType;
  videoFormat?: AdaptiveFormatItem | null;
  audioFormat?: AdaptiveFormatItem | null;
}>;
export function resolveQualityLabel({ type, videoFormat, audioFormat }: ResolveQualityLabelParams) {
  const isAudioOnly = type === DownloadType.Audio;
  if (isAudioOnly) {
    return audioFormat ? getAudioQualityLabel(audioFormat) : undefined;
  }

  if (videoFormat?.height) {
    return `${videoFormat.height}p`;
  }

  return undefined;
}

export function normalizeLanguageCode(lang: string) {
  return lang.split("-")[0].split(".")[0].toLowerCase();
}

export function getCurrentVideoAudioLanguage() {
  const elVideo = document.querySelector<HTMLVideoElement>(VIDEO_SELECTOR);
  const tracks = elVideo?.audioTracks;
  const hasTracks = !!tracks?.length;
  if (!hasTracks) {
    return null;
  }

  for (const track of tracks) {
    const isTrackEnabled = track.enabled;
    if (isTrackEnabled) {
      return normalizeLanguageCode(track.language);
    }
  }

  return null;
}

export function findOriginalAudioFormat(audioFormats: AdaptiveFormatItem[]) {
  const noTrack = audioFormats.find(format => !format.audioTrack);
  if (noTrack) {
    return noTrack;
  }

  return audioFormats.find(format => format.audioTrack?.id.endsWith(AUDIO_TRACK_ORIGINAL_SUFFIX))
    ?? audioFormats.find(format => format.audioTrack?.displayName.includes(AUDIO_TRACK_ORIGINAL_LABEL))
    ?? audioFormats.find(format => format.audioTrack?.audioIsDefault)
    ?? null;
}

export function sortAudioFormatsByDisplayName(audioFormats: AdaptiveFormatItem[]) {
  return audioFormats
    .filter(format => format.audioTrack)
    .toSorted((formatA, formatB) =>
      formatA.audioTrack!.displayName.localeCompare(formatB.audioTrack!.displayName));
}
