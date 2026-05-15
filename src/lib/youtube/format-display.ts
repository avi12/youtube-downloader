import type { AdaptiveFormatItem } from "@/types";

export function formatVideoQualityLabel(format: Pick<AdaptiveFormatItem, "height" | "fps" | "qualityLabel">) {
  const base = `${format.height}p${format.fps ? ` ${format.fps}fps` : ""}`;
  const isPremium = (format.qualityLabel ?? "").includes("Premium");
  return isPremium ? `${base} (Enhanced)` : base;
}

export function formatAudioCodecLabel(mimeType: string) {
  const [, codec = ""] = mimeType.match(/codecs="([^"]+)"/) ?? [];
  const isAac = codec.startsWith("mp4a");
  if (isAac) {
    return "AAC";
  }

  const isOpus = codec === "opus";
  if (isOpus) {
    return "Opus";
  }

  const isEc3 = codec.startsWith("ec-3");
  if (isEc3) {
    return "EC-3";
  }

  return codec || (mimeType.split(";")[0].split("/")[1] ?? "");
}
