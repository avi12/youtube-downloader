import { normalizeLanguageCode, findOriginalAudioFormat } from "./audio-format-helpers";
import { isAudioMimeNativeForContainer } from "@/lib/utils/containers";
import { AudioTrackLanguageMode } from "@/types";
import type { AdaptiveFormatItem } from "@/types";

const FALLBACK_LANGUAGE_CODE = "en";

type MatchAudioFormatToLanguageParams = {
  audioFormats: AdaptiveFormatItem[];
  langCode: string;
};
function matchAudioFormatToLanguage({ audioFormats, langCode }: MatchAudioFormatToLanguageParams) {
  return audioFormats.find(format => normalizeLanguageCode(format.audioTrack?.id ?? "") === langCode);
}

type PrependMatchParams = {
  audioFormats: AdaptiveFormatItem[];
  match: AdaptiveFormatItem | undefined | null;
};
function prependMatch({ audioFormats, match }: PrependMatchParams) {
  return match ? [match, ...audioFormats.filter(format => format !== match)] : [];
}

type SelectPreferredAudioFormatParams = {
  audioFormats: AdaptiveFormatItem[];
  videoMimeType: string;
  languageMode: AudioTrackLanguageMode;
  locale: string;
  browserLanguage?: string;
  customLanguage?: string;
};
export function selectPreferredAudioFormat({
  audioFormats,
  videoMimeType,
  languageMode,
  locale,
  browserLanguage,
  customLanguage
}: SelectPreferredAudioFormatParams) {
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
        langCode: FALLBACK_LANGUAGE_CODE
      });
    candidates = prependMatch({
      audioFormats,
      match
    });
  } else {
    const isOriginalLanguageMode = languageMode === AudioTrackLanguageMode.OriginalLanguage;
    if (isOriginalLanguageMode) {
      candidates = prependMatch({
        audioFormats,
        match: originalTrack
      });
    }
  }

  const hasNoCandidates = !candidates.length;
  if (hasNoCandidates) {
    const langPriority = [locale, browserLanguage, FALLBACK_LANGUAGE_CODE]
      .filter((lang): lang is string => !!lang);
    for (const lang of langPriority) {
      const match = matchAudioFormatToLanguage({
        audioFormats,
        langCode: normalizeLanguageCode(lang)
      });
      if (match) {
        candidates = prependMatch({
          audioFormats,
          match
        });
        break;
      }
    }
  }

  const isStillNoCandidates = !candidates.length;
  if (isStillNoCandidates) {
    candidates = originalTrack ? prependMatch({
      audioFormats,
      match: originalTrack
    }) : audioFormats;
  }

  if (isWebm) {
    return candidates.find(format => format.mimeType.includes("webm")) ?? candidates[0] ?? null;
  }

  return candidates[0] ?? null;
}

function pickBestByBitrate(formats: AdaptiveFormatItem[]) {
  return formats.reduce<AdaptiveFormatItem | null>(
    (best, format) => !best || format.bitrate > best.bitrate ? format : best,
    null
  );
}

type AlignAudioFormatToExtensionParams = {
  audioFormats: AdaptiveFormatItem[];
  currentFormat: AdaptiveFormatItem | null;
  targetExtension: string;
};
export function alignAudioFormatToExtension({
  audioFormats,
  currentFormat,
  targetExtension
}: AlignAudioFormatToExtensionParams) {
  const isCurrentCompatible = currentFormat
    && isAudioMimeNativeForContainer({
      audioMimeType: currentFormat.mimeType,
      targetExtension
    });
  if (isCurrentCompatible) {
    return currentFormat;
  }

  const selectedTrackId = currentFormat?.audioTrack?.id;
  const sameTrackCandidates = selectedTrackId
    ? audioFormats.filter(format => format.audioTrack?.id === selectedTrackId)
    : audioFormats;
  const candidates = sameTrackCandidates.length ? sameTrackCandidates : audioFormats;
  const nativeFormats = candidates.filter(format => isAudioMimeNativeForContainer({
    audioMimeType: format.mimeType,
    targetExtension
  }));

  return pickBestByBitrate(nativeFormats) ?? pickBestByBitrate(candidates) ?? currentFormat;
}
