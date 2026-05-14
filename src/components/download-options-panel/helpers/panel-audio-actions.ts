import type { AdaptiveFormatItem } from "@/types";

export function findMatchVideoAudioFormat(audioFormats: AdaptiveFormatItem[]): AdaptiveFormatItem | null {
  return audioFormats.find(format => !format.audioTrack)
    ?? audioFormats.find(format => format.audioTrack?.audioIsDefault)
    ?? audioFormats[0]
    ?? null;
}
