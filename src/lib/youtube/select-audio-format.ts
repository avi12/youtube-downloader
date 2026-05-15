import { normalizeLanguageCode, findOriginalAudioFormat } from "./audio-format-helpers";
import { AudioTrackLanguageMode } from "@/types";
import type { AdaptiveFormatItem } from "@/types";

function matchAudioFormatToLanguage({ audioFormats, langCode }: {
  audioFormats: AdaptiveFormatItem[];
  langCode: string;
}) {
  return audioFormats.find(format => normalizeLanguageCode(format.audioTrack?.id ?? "") === langCode);
}

function prependMatch(audioFormats: AdaptiveFormatItem[], match: AdaptiveFormatItem | undefined | null) {
  return match ? [match, ...audioFormats.filter(fmt => fmt !== match)] : [];
}

export function selectPreferredAudioFormat({
  audioFormats,
  videoMimeType,
  languageMode,
  locale,
  browserLanguage,
  customLanguage
}: {
  audioFormats: AdaptiveFormatItem[];
  videoMimeType: string;
  languageMode: AudioTrackLanguageMode;
  locale: string;
  browserLanguage?: string;
  customLanguage?: string;
}) {
  const hasNoFormats = !audioFormats.length;
  if (hasNoFormats) {
    return null;
  }

  const isWebm = videoMimeType.includes("webm");
  const originalTrack = findOriginalAudioFormat(audioFormats);

  let candidates: AdaptiveFormatItem[] = [];
  const isCustomWithLanguage = languageMode === AudioTrackLanguageMode.Custom && customLanguage;
  if (isCustomWithLanguage) {
    const langCode = normalizeLanguageCode(customLanguage);
    const match = matchAudioFormatToLanguage({
      audioFormats,
      langCode
    })
      ?? matchAudioFormatToLanguage({
        audioFormats,
        langCode: "en"
      });
    candidates = prependMatch(audioFormats, match);
  } else if (languageMode === AudioTrackLanguageMode.OriginalLanguage) {
    candidates = prependMatch(audioFormats, originalTrack);
  }

  const hasNoCandidates = !candidates.length;
  if (hasNoCandidates) {
    const langPriority = [locale, browserLanguage, "en"]
      .filter((lang): lang is string => !!lang);
    for (const lang of langPriority) {
      const match = matchAudioFormatToLanguage({
        audioFormats,
        langCode: normalizeLanguageCode(lang)
      });
      if (match) {
        candidates = prependMatch(audioFormats, match);
        break;
      }
    }
  }

  if (!candidates.length) {
    candidates = originalTrack ? prependMatch(audioFormats, originalTrack) : audioFormats;
  }

  if (isWebm) {
    return candidates.find(format => format.mimeType.includes("webm")) ?? candidates[0] ?? null;
  }

  return candidates[0] ?? null;
}
