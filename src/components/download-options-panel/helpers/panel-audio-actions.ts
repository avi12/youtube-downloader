import { normalizeLanguageCode } from "@/lib/youtube/video-helpers";
import type { AdaptiveFormatItem } from "@/types";

export function findMatchVideoAudioFormat(audioFormats: AdaptiveFormatItem[]): AdaptiveFormatItem | null {
  return audioFormats.find(format => !format.audioTrack)
    ?? audioFormats.find(format => format.audioTrack?.audioIsDefault)
    ?? audioFormats[0]
    ?? null;
}

export function findAudioFormatForPlayerTrack({ audioFormats, trackId, langCode }: {
  audioFormats: AdaptiveFormatItem[];
  trackId: string | null;
  langCode: string | null;
}): AdaptiveFormatItem | null {
  const exactMatches = trackId
    ? audioFormats.filter(format => format.audioTrack?.id === trackId)
    : [];
  const langMatches = langCode
    ? audioFormats.filter(format => format.audioTrack && normalizeLanguageCode(format.audioTrack.id) === langCode)
    : [];
  const matches = exactMatches.length ? exactMatches : langMatches;
  if (!matches.length) {
    return null;
  }

  return matches.reduce((best, format) => format.bitrate > best.bitrate ? format : best);
}
