import { CAPTION_KIND_ASR } from "./audio-language-helpers";
import { IS_WATCH_PAGE } from "./panel-init-audio";
import { ACTIVE_CAPTION_ATTR } from "@/lib/youtube/movie-player";
import type { MoviePlayerElement } from "@/lib/youtube/movie-player";
import { playerCaptionTrackDataSchema } from "@/lib/youtube/schemas";
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
  type Prettify,
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
    return playerCaptionTrackDataSchema.parse(JSON.parse(stored));
  } catch {
    return null;
  }
}

type ResolveInitialCaptionModeParams = Prettify<{
  options: Options;
  videoData: VideoData;
}>;
export function resolveInitialCaptionMode({ options, videoData }: ResolveInitialCaptionModeParams) {
  const resolvedMode = resolveCaptionLanguageMode({
    captionMode: options.captionLanguageMode,
    audioMode: options.audioTrackLanguageMode
  });
  const isOriginalLanguageMode = resolvedMode === AudioTrackLanguageMode.OriginalLanguage;
  if (isOriginalLanguageMode) {
    return PanelTrackMode.Original;
  }

  const isCustomWithLanguage = resolvedMode === AudioTrackLanguageMode.Custom && options.customLanguage;
  if (isCustomWithLanguage) {
    const langCode = normalizeLanguageCode(options.customLanguage);
    const isMatchFound = videoData.captionTracks.some(track => normalizeLanguageCode(track.languageCode) === langCode);
    if (isMatchFound) {
      return PanelTrackMode.Custom;
    }
  }

  return PanelTrackMode.MatchVideo;
}

type ResolveCustomCaptionParams = Prettify<{
  candidateTracks: CaptionTrack[];
  langCode: string;
}>;
function resolveCustomCaption({ candidateTracks, langCode }: ResolveCustomCaptionParams) {
  return candidateTracks.find(track => normalizeLanguageCode(track.languageCode) === langCode)
    ?? candidateTracks[0]
    ?? null;
}

type ResolveOriginalCaptionParams = Prettify<{
  candidateTracks: CaptionTrack[];
  audioFormats: AdaptiveFormatItem[];
}>;
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

type ResolveMatchVideoCaptionParams = Prettify<{
  allTracks: CaptionTrack[];
  candidateTracks: CaptionTrack[];
}>;
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

  if (IS_WATCH_PAGE) {
    return null;
  }

  return orderCaptionsByPreference({
    captionTracks: candidateTracks,
    languageMode: AudioTrackLanguageMode.MatchYouTube,
    locale: document.documentElement.lang,
    browserLanguage: navigator.language
  })[0] ?? null;
}

type ResolveInitialCaptionTrackParams = Prettify<{
  captionMode: PanelTrackMode;
  options: Options;
  videoData: VideoData;
}>;
export function resolveInitialCaptionTrack({
  captionMode,
  options,
  videoData
}: ResolveInitialCaptionTrackParams) {
  if (!videoData.captionTracks.length) {
    return null;
  }

  const allTracksAreAsr = videoData.captionTracks.every(track => track.kind === CAPTION_KIND_ASR);
  const candidateTracks = options.includeAiCaptions || allTracksAreAsr
    ? videoData.captionTracks
    : videoData.captionTracks.filter(track => track.kind !== CAPTION_KIND_ASR);
  const isCustomMode = captionMode === PanelTrackMode.Custom;
  if (isCustomMode) {
    return resolveCustomCaption({
      candidateTracks,
      langCode: normalizeLanguageCode(options.customLanguage ?? "")
    });
  }

  const isOriginalMode = captionMode === PanelTrackMode.Original;
  if (isOriginalMode) {
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
