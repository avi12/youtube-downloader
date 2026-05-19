import { CAPTION_KIND_ASR } from "./audio-language-helpers";
import { ACTIVE_CAPTION_ATTR, isPlayerCaptionTrackData } from "@/lib/youtube/movie-player";
import type { MoviePlayerElement } from "@/lib/youtube/movie-player";
import {
  findOriginalAudioFormat,
  normalizeLanguageCode,
  orderCaptionsByPreference,
  resolveCaptionLanguageMode
} from "@/lib/youtube/video-helpers";
import {
  AudioTrackLanguageMode,
  PanelTrackMode,
  type AdaptiveFormatItem,
  type CaptionTrack,
  type Options,
  type VideoData
} from "@/types";

const MOVIE_PLAYER_SELECTOR = "#movie_player";

export function getActivePlayerCaption() {
  const elPlayer = document.querySelector<MoviePlayerElement>(MOVIE_PLAYER_SELECTOR);
  const stored = elPlayer?.getAttribute(ACTIVE_CAPTION_ATTR);
  if (!stored) {
    return null;
  }

  try {
    const data: unknown = JSON.parse(stored);
    return isPlayerCaptionTrackData(data) ? data : null;
  } catch {
    return null;
  }
}

type ResolveInitialCaptionModeParams = {
  options: Options;
  videoData: VideoData;
};
export function resolveInitialCaptionMode({ options, videoData }: ResolveInitialCaptionModeParams) {
  const resolvedMode = resolveCaptionLanguageMode({
    captionMode: options.captionLanguageMode,
    audioMode: options.audioTrackLanguageMode
  });
  const isCustomWithLanguage = resolvedMode === AudioTrackLanguageMode.Custom && options.customLanguage;
  if (isCustomWithLanguage) {
    const langCode = normalizeLanguageCode(options.customLanguage);
    const hasMatch = videoData.captionTracks.some(track => normalizeLanguageCode(track.languageCode) === langCode);
    if (hasMatch) {
      return PanelTrackMode.Custom;
    }
  }

  return PanelTrackMode.MatchVideo;
}

type ResolveCustomCaptionParams = {
  candidateTracks: CaptionTrack[];
  langCode: string;
};
function resolveCustomCaption({ candidateTracks, langCode }: ResolveCustomCaptionParams) {
  return candidateTracks.find(track => normalizeLanguageCode(track.languageCode) === langCode)
    ?? candidateTracks[0]
    ?? null;
}

type ResolveOriginalCaptionParams = {
  candidateTracks: CaptionTrack[];
  audioFormats: AdaptiveFormatItem[];
};
function resolveOriginalCaption({ candidateTracks, audioFormats }: ResolveOriginalCaptionParams) {
  const originalLangId = findOriginalAudioFormat(audioFormats)?.audioTrack?.id;
  if (originalLangId) {
    const langCode = normalizeLanguageCode(originalLangId);
    const manualMatch = candidateTracks.find(
      track => normalizeLanguageCode(track.languageCode) === langCode && !track.kind
    );
    const match = manualMatch
      ?? candidateTracks.find(track => normalizeLanguageCode(track.languageCode) === langCode);
    if (match) {
      return match;
    }
  }

  return candidateTracks.find(track => !track.kind) ?? candidateTracks[0] ?? null;
}

type ResolveMatchVideoCaptionParams = {
  allTracks: CaptionTrack[];
  candidateTracks: CaptionTrack[];
};
// Only preserve the player's active caption (even if ASR); fall back to filtered
// candidates so an absent player caption doesn't auto-pick an ASR default.
function resolveMatchVideoCaption({ allTracks, candidateTracks }: ResolveMatchVideoCaptionParams) {
  const activeCaption = getActivePlayerCaption();
  if (activeCaption) {
    const match = allTracks.find(track => track.vssId === activeCaption.vss_id)
      ?? allTracks.find(
        track => normalizeLanguageCode(track.languageCode) === normalizeLanguageCode(activeCaption.languageCode)
      );
    if (match) {
      return match;
    }
  }

  return orderCaptionsByPreference({
    captionTracks: candidateTracks,
    languageMode: AudioTrackLanguageMode.MatchYouTube,
    locale: document.documentElement.lang,
    browserLanguage: navigator.language
  })[0] ?? null;
}

type ResolveInitialCaptionTrackParams = {
  captionMode: PanelTrackMode;
  options: Options;
  videoData: VideoData;
};
export function resolveInitialCaptionTrack({
  captionMode,
  options,
  videoData
}: ResolveInitialCaptionTrackParams) {
  if (!videoData.captionTracks.length) {
    return null;
  }

  const candidateTracks = options.includeAiCaptions
    ? videoData.captionTracks
    : videoData.captionTracks.filter(track => track.kind !== CAPTION_KIND_ASR);
  if (captionMode === PanelTrackMode.Custom) {
    return resolveCustomCaption({
      candidateTracks,
      langCode: normalizeLanguageCode(options.customLanguage ?? "")
    });
  }

  if (captionMode === PanelTrackMode.Original) {
    return resolveOriginalCaption({
      candidateTracks,
      audioFormats: videoData.audioFormats
    });
  }

  return resolveMatchVideoCaption({
    allTracks: videoData.captionTracks,
    candidateTracks
  });
}
