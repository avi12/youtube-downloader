import { findOriginalAudioFormat, normalizeLanguageCode } from "@/lib/youtube/video-helpers";
import type { AdaptiveFormatItem, CaptionTrack, LabeledOption } from "@/types";

export function byLabel(optA: { label: string }, optB: { label: string }) {
  return optA.label.localeCompare(optB.label);
}

export function buildUniqueAudioLanguages(audioFormats: AdaptiveFormatItem[]) {
  const seen = new Set<string>();
  const result: LabeledOption[] = [];
  for (const format of audioFormats) {
    if (!format.audioTrack || format.audioTrack.id.endsWith(".10")) {
      continue;
    }

    const langCode = normalizeLanguageCode(format.audioTrack.id);
    if (seen.has(langCode)) {
      continue;
    }

    seen.add(langCode);
    result.push({
      value: langCode,
      label: format.audioTrack.displayName
    });
  }

  return result.toSorted(byLabel);
}

export function resolveCaptionOriginalLabel(
  audioFormats: AdaptiveFormatItem[],
  captionTracks: CaptionTrack[]
): string | null {
  const originalLangId = findOriginalAudioFormat(audioFormats)?.audioTrack?.id;
  if (originalLangId) {
    const langCode = normalizeLanguageCode(originalLangId);
    const match =
      captionTracks.find(track => normalizeLanguageCode(track.languageCode) === langCode && !track.kind)
      ?? captionTracks.find(track => normalizeLanguageCode(track.languageCode) === langCode);
    if (match) {
      return match.name.simpleText;
    }
  }

  return captionTracks.find(track => !track.kind)?.name.simpleText
    ?? captionTracks[0]?.name.simpleText
    ?? null;
}
