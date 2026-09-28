import { isPremiumFormat } from "@/lib/youtube/format-display";
import type { AdaptiveFormatItem } from "@/types";

const MIME_PREFIX_VIDEO = "video";
const MIME_PREFIX_AUDIO = "audio";

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

    const key = `${format.height}-${isPremiumFormat(format)}`;
    const isSeenKey = seen.has(key);
    if (isSeenKey) {
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
    const isSeenKey = seenKeys.has(key);
    if (isSeenKey) {
      return false;
    }

    seenKeys.add(key);
    return true;
  });
}
