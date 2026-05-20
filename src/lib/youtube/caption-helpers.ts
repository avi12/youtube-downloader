import { normalizeLanguageCode } from "./audio-format-helpers";
import { AudioTrackLanguageMode, CaptionLanguageMode } from "@/types";
import type { CaptionTrack } from "@/types";

const FALLBACK_LANGUAGE_CODE = "en";

const CAPTION_TO_AUDIO_MODE: Partial<Record<CaptionLanguageMode, AudioTrackLanguageMode>> = {
  [CaptionLanguageMode.OriginalLanguage]: AudioTrackLanguageMode.OriginalLanguage,
  [CaptionLanguageMode.MatchVideo]: AudioTrackLanguageMode.MatchVideo,
  [CaptionLanguageMode.MatchYouTube]: AudioTrackLanguageMode.MatchYouTube,
  [CaptionLanguageMode.Custom]: AudioTrackLanguageMode.Custom
};

type ResolveCaptionLanguageModeParams = {
  captionMode: CaptionLanguageMode;
  audioMode: AudioTrackLanguageMode;
};
export function resolveCaptionLanguageMode({ captionMode, audioMode }: ResolveCaptionLanguageModeParams) {
  return CAPTION_TO_AUDIO_MODE[captionMode] ?? audioMode;
}

type OrderCaptionsByPreferenceParams = {
  captionTracks: CaptionTrack[];
  languageMode: AudioTrackLanguageMode;
  locale: string;
  browserLanguage?: string;
  customLanguage?: string;
};
export function orderCaptionsByPreference({
  captionTracks,
  languageMode,
  locale,
  browserLanguage,
  customLanguage
}: OrderCaptionsByPreferenceParams) {
  const hasSingleTrack = captionTracks.length <= 1;
  const isOriginalLanguageMode = languageMode === AudioTrackLanguageMode.OriginalLanguage;
  const isOrderingUnnecessary = hasSingleTrack || isOriginalLanguageMode;
  if (isOrderingUnnecessary) {
    return captionTracks;
  }

  const isCustomWithLanguage = languageMode === AudioTrackLanguageMode.Custom && customLanguage;
  const firstLang = isCustomWithLanguage
    ? normalizeLanguageCode(customLanguage!)
    : null;
  const langPriority = [firstLang, locale, browserLanguage, FALLBACK_LANGUAGE_CODE]
    .filter((lang): lang is string => !!lang);

  for (const lang of langPriority) {
    const normalized = normalizeLanguageCode(lang);
    const preferred = captionTracks.filter(track => normalizeLanguageCode(track.languageCode) === normalized);
    if (preferred.length) {
      const rest = captionTracks.filter(track => normalizeLanguageCode(track.languageCode) !== normalized);
      return [...preferred, ...rest];
    }
  }

  return captionTracks;
}
