import { normalizeLanguageCode, findOriginalAudioFormat } from "./audio-format-helpers";
import { AudioTrackLanguageMode } from "@/types";
import type { AdaptiveFormatItem } from "@/types";

function matchAudioFormatToLanguage(audioFormats: AdaptiveFormatItem[], langCode: string) {
  return audioFormats.find(format => normalizeLanguageCode(format.audioTrack?.id ?? "") === langCode);
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
  if (!audioFormats.length) {
    return null;
  }

  const isWebm = videoMimeType.includes("webm");
  const originalTrack = findOriginalAudioFormat(audioFormats);

  let candidates: AdaptiveFormatItem[] = [];
  if (languageMode === AudioTrackLanguageMode.Custom && customLanguage) {
    const langCode = normalizeLanguageCode(customLanguage);
    const match = matchAudioFormatToLanguage(audioFormats, langCode)
      ?? matchAudioFormatToLanguage(audioFormats, "en");
    if (match) {
      candidates = [match, ...audioFormats.filter(format => format !== match)];
    }
  } else if (languageMode === AudioTrackLanguageMode.OriginalLanguage) {
    if (originalTrack) {
      candidates = [originalTrack, ...audioFormats.filter(format => format !== originalTrack)];
    }
  }

  if (!candidates.length) {
    const langPriority = [locale, browserLanguage, "en"]
      .filter((lang): lang is string => !!lang);
    for (const lang of langPriority) {
      const match = matchAudioFormatToLanguage(audioFormats, normalizeLanguageCode(lang));
      if (match) {
        candidates = [match, ...audioFormats.filter(format => format !== match)];
        break;
      }
    }
  }

  if (!candidates.length) {
    candidates = originalTrack
      ? [originalTrack, ...audioFormats.filter(format => format !== originalTrack)]
      : audioFormats;
  }

  if (isWebm) {
    return candidates.find(format => format.mimeType.includes("webm")) ?? candidates[0] ?? null;
  }

  return candidates[0] ?? null;
}
