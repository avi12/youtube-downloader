import type { AdaptiveFormatItem } from "@/types";

const MIME_PREFIX_VIDEO = "video";
const MIME_PREFIX_AUDIO = "audio";
const QUALITY_LABEL_PREMIUM = "Premium";

export function byQualityDesc(formatA: AdaptiveFormatItem, formatB: AdaptiveFormatItem) {
  const heightDiff = (formatB.height ?? 0) - (formatA.height ?? 0);
  return heightDiff !== 0 ? heightDiff : formatB.bitrate - formatA.bitrate;
}

export function getUniqueVideoFormats(formats: AdaptiveFormatItem[]) {
  const videoFormats = formats.filter(format => format.mimeType.startsWith(MIME_PREFIX_VIDEO));
  const seen = new Set<string>();

  return videoFormats.filter(format => {
    if (!format.height) {
      return false;
    }

    const isPremium = (format.qualityLabel ?? "").includes(QUALITY_LABEL_PREMIUM);
    const key = `${format.height}-${isPremium}`;
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

export function getAudioFormats(formats: AdaptiveFormatItem[]) {
  const audioFormats = formats.filter(format => format.mimeType.startsWith(MIME_PREFIX_AUDIO));
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
