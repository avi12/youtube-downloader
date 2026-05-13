import type { AdaptiveFormatItem } from "@/types";

export function formatVideoQualityLabel(format: Pick<AdaptiveFormatItem, "height" | "fps" | "qualityLabel">) {
  const base = `${format.height}p${format.fps ? ` ${format.fps}fps` : ""}`;
  const isPremium = (format.qualityLabel ?? "").includes("Premium");
  return isPremium ? `${base} (Enhanced)` : base;
}

export function formatAudioCodecLabel(mimeType: string) {
  const [, codec = ""] = mimeType.match(/codecs="([^"]+)"/) ?? [];
  if (codec.startsWith("mp4a")) {
    return "AAC";
  }

  if (codec === "opus") {
    return "Opus";
  }

  if (codec.startsWith("ec-3")) {
    return "EC-3";
  }

  return codec || (mimeType.split(";")[0].split("/")[1] ?? "");
}
