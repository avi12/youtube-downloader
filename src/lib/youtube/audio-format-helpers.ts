import { AudioTrackLanguageMode } from "@/types";
import type { AdaptiveFormatItem } from "@/types";

export function normalizeLanguageCode(lang: string) {
  return lang.split("-")[0].split(".")[0].toLowerCase();
}

export function getCurrentVideoAudioLanguage(): string | null {
  const elVideo = document.querySelector<HTMLVideoElement>("video.html5-main-video");
  const tracks = elVideo?.audioTracks;
  if (!tracks?.length) {
    return null;
  }

  for (const track of tracks) {
    if (track.enabled) {
      return normalizeLanguageCode(track.language);
    }
  }

  return null;
}

function matchAudioFormatToLanguage(audioFormats: AdaptiveFormatItem[], langCode: string) {
  return audioFormats.find(format => normalizeLanguageCode(format.audioTrack?.id ?? "") === langCode);
}

export function findOriginalAudioFormat(audioFormats: AdaptiveFormatItem[]) {
  const noTrack = audioFormats.find(format => !format.audioTrack);
  if (noTrack) {
    return noTrack;
  }

  return audioFormats.find(format => format.audioTrack?.id.endsWith(".4"))
    ?? audioFormats.find(format => format.audioTrack?.displayName.includes("(original)"))
    ?? audioFormats.find(format => format.audioTrack?.audioIsDefault)
    ?? null;
}

export function sortAudioFormatsByDisplayName(audioFormats: AdaptiveFormatItem[]) {
  return audioFormats
    .filter(format => format.audioTrack)
    .toSorted((formatA, formatB) =>
      formatA.audioTrack!.displayName.localeCompare(formatB.audioTrack!.displayName));
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
