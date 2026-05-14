import type { AdaptiveFormatItem } from "@/types";

export function byQualityDesc(formatA: AdaptiveFormatItem, formatB: AdaptiveFormatItem) {
  const heightDiff = (formatB.height ?? 0) - (formatA.height ?? 0);
  return heightDiff !== 0 ? heightDiff : formatB.bitrate - formatA.bitrate;
}

export function getUniqueVideoFormats(formats: AdaptiveFormatItem[]) {
  const videoFormats = formats.filter(format => format.mimeType.startsWith("video"));
  // Dedup by height + premium status so standard and enhanced bitrate variants are distinct.
  const seen = new Set<string>();

  return videoFormats.filter(format => {
    if (!format.height) {
      return false;
    }

    const isPremium = (format.qualityLabel ?? "").includes("Premium");
    const key = `${format.height}-${isPremium}`;
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

export function getAudioFormats(formats: AdaptiveFormatItem[]) {
  const audioFormats = formats.filter(format => format.mimeType.startsWith("audio"));
  // Dedup by itag + audioTrack.id so different language tracks with the same itag
  // (e.g. original + dubbed) are preserved.
  const seenKeys = new Set<string>();
  return audioFormats.filter(format => {
    const key = `${format.itag}:${format.audioTrack?.id ?? ""}`;
    if (seenKeys.has(key)) {
      return false;
    }

    seenKeys.add(key);
    return true;
  });
}
