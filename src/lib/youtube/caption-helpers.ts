import { normalizeLanguageCode } from "./audio-format-helpers";
import { AudioTrackLanguageMode, CaptionLanguageMode } from "@/types";
import type { CaptionTrack } from "@/types";

const CAPTION_TO_AUDIO_MODE: Partial<Record<CaptionLanguageMode, AudioTrackLanguageMode>> = {
  [CaptionLanguageMode.OriginalLanguage]: AudioTrackLanguageMode.OriginalLanguage,
  [CaptionLanguageMode.MatchVideo]: AudioTrackLanguageMode.MatchVideo,
  [CaptionLanguageMode.MatchYouTube]: AudioTrackLanguageMode.MatchYouTube,
  [CaptionLanguageMode.Custom]: AudioTrackLanguageMode.Custom
};

export function resolveCaptionLanguageMode({ captionMode, audioMode }: {
  captionMode: CaptionLanguageMode;
  audioMode: AudioTrackLanguageMode;
}) {
  return CAPTION_TO_AUDIO_MODE[captionMode] ?? audioMode;
}

export function orderCaptionsByPreference({
  captionTracks,
  languageMode,
  locale,
  browserLanguage,
  customLanguage
}: {
  captionTracks: CaptionTrack[];
  languageMode: AudioTrackLanguageMode;
  locale: string;
  browserLanguage?: string;
  customLanguage?: string;
}) {
  const isOrderingUnnecessary = captionTracks.length <= 1 || languageMode === AudioTrackLanguageMode.OriginalLanguage;
  if (isOrderingUnnecessary) {
    return captionTracks;
  }

  const firstLang = languageMode === AudioTrackLanguageMode.Custom && customLanguage
    ? normalizeLanguageCode(customLanguage)
    : null;
  const langPriority = [firstLang, locale, browserLanguage, "en"]
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
