import type { AdaptiveFormatItem } from "@/types";

const CODEC_PREFIX_AAC = "mp4a";
const CODEC_OPUS = "opus";
const CODEC_PREFIX_EC3 = "ec-3";
const QUALITY_LABEL_PREMIUM = "Premium";

export function formatVideoQualityLabel(format: Pick<AdaptiveFormatItem, "height" | "fps" | "qualityLabel">) {
  const base = `${format.height}p${format.fps ? ` ${format.fps}fps` : ""}`;
  const isPremium = (format.qualityLabel ?? "").includes(QUALITY_LABEL_PREMIUM);
  return isPremium ? `${base} (Enhanced)` : base;
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

  return codec || (mimeType.split(";")[0].split("/")[1] ?? "");
}
