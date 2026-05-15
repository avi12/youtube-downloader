import { preserveAutoVariant } from "./preserve-auto-variant";
import { findOriginalAudioFormat, normalizeLanguageCode } from "@/lib/youtube/video-helpers";
import type { AdaptiveFormatItem, CaptionTrack, LabeledOption } from "@/types";

export function byLabel(optA: { label: string }, optB: { label: string }) {
  return optA.label.localeCompare(optB.label);
}

export function buildUniqueAudioLanguages({
  audioFormats, includeAutoDubbing = false, preservedAutoDubbedLangCode = null
}: {
  audioFormats: AdaptiveFormatItem[];
  includeAutoDubbing?: boolean;
  preservedAutoDubbedLangCode?: string | null;
}) {
  const seen = new Set<string>();
  const result: LabeledOption[] = [];
  for (const format of audioFormats) {
    if (!format.audioTrack) {
      continue;
    }

    const shouldKeep = preserveAutoVariant({
      item: format,
      isAuto: candidate => !!candidate.audioTrack?.id.endsWith(".10"),
      matchesPlayer: candidate => normalizeLanguageCode(candidate.audioTrack!.id) === preservedAutoDubbedLangCode,
      globalIncludes: includeAutoDubbing
    });
    if (!shouldKeep) {
      continue;
    }

    const langCode = normalizeLanguageCode(format.audioTrack.id);
    if (seen.has(langCode)) {
      continue;
    }

    seen.add(langCode);
    const isAutoDubbed = format.audioTrack.id.endsWith(".10");
    result.push({
      value: langCode,
      label: isAutoDubbed ? `${format.audioTrack.displayName} (auto-dubbed)` : format.audioTrack.displayName
    });
  }

  return result.toSorted(byLabel);
}

export function resolveCaptionOriginalLabel({
  audioFormats,
  captionTracks
}: {
  audioFormats: AdaptiveFormatItem[];
  captionTracks: CaptionTrack[];
}): string | null {
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
