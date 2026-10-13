import type { AdaptiveFormatItem } from "@/types";

const CODEC_PREFIX_AAC = "mp4a";
const CODEC_OPUS = "opus";
const CODEC_PREFIX_EC3 = "ec-3";
const CODEC_PREFIX_AC3 = "ac-3";
const QUALITY_LABEL_PREMIUM = "Premium";
const BITS_PER_KILOBIT = 1000;

export function isPremiumFormat(format: Pick<AdaptiveFormatItem, "qualityLabel">) {
  return (format.qualityLabel ?? "").includes(QUALITY_LABEL_PREMIUM);
}

export function filterVideoFormatsByEnhancedBitrate(formats: AdaptiveFormatItem[], enhancedBitrate: boolean) {
  return enhancedBitrate ? formats : formats.filter(format => !isPremiumFormat(format));
}

export function formatVideoQualityLabel(format: Pick<AdaptiveFormatItem, "height" | "fps" | "qualityLabel">) {
  const base = `${format.height}p${format.fps ? ` ${format.fps}fps` : ""}`;
  return isPremiumFormat(format) ? `${base} (Enhanced)` : base;
}

export function formatAudioCodecLabel(mimeType: string) {
  const [, codec = ""] = mimeType.match(/codecs="([^"]+)"/) ?? [];
  const isAac = codec.startsWith(CODEC_PREFIX_AAC);
  if (isAac) {
    return "AAC";
  }

  const isOpus = codec === CODEC_OPUS;
  if (isOpus) {
    return "Opus";
  }

  const isEc3 = codec.startsWith(CODEC_PREFIX_EC3);
  if (isEc3) {
    return "EC-3";
  }

  const isAc3 = codec.startsWith(CODEC_PREFIX_AC3);
  if (isAc3) {
    return "AC-3";
  }

  return codec || (mimeType.split(";")[0]!.split("/")[1] ?? "");
}

export function formatAudioQualityLabel(format: Pick<AdaptiveFormatItem, "bitrate" | "mimeType">) {
  return `${Math.floor(format.bitrate / BITS_PER_KILOBIT)} kbps (${formatAudioCodecLabel(format.mimeType)})`;
}
