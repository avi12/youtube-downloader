import { formatAudioCodecLabel } from "@/lib/utils/container-specs";
import type { AdaptiveFormatItem } from "@/types";

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

export function formatAudioBitrateLabel(format: Pick<AdaptiveFormatItem, "bitrate">) {
  return `${Math.floor(format.bitrate / BITS_PER_KILOBIT)} kbps`;
}

export function formatAudioQualityLabel(format: Pick<AdaptiveFormatItem, "bitrate" | "mimeType">) {
  return `${formatAudioBitrateLabel(format)} (${formatAudioCodecLabel(format.mimeType)})`;
}
