import { normalizeLanguageCode } from "@/lib/youtube/video-helpers";
import type { AdaptiveFormatItem, Prettify } from "@/types";

export function findMatchVideoAudioFormat(audioFormats: AdaptiveFormatItem[]) {
  return audioFormats.find(format => !format.audioTrack)
    ?? audioFormats.find(format => format.audioTrack?.audioIsDefault)
    ?? audioFormats[0]
    ?? null;
}

type FindAudioFormatForPlayerTrackParams = Prettify<{
  audioFormats: AdaptiveFormatItem[];
  trackId: string | null;
  langCode: string | null;
}>;
export function findAudioFormatForPlayerTrack({
  audioFormats,
  trackId,
  langCode
}: FindAudioFormatForPlayerTrackParams) {
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
