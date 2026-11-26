import { CAPTION_KIND_ASR } from "./audio-language-helpers";
import { IS_WATCH_PAGE } from "./watch-page";
import { ACTIVE_CAPTION_ATTR, getMoviePlayer, isPlayerCaptionTrackData } from "@/lib/youtube/movie-player";
import {
  findOriginalAudioFormat,
  normalizeLanguageCode,
  orderCaptionsByPreference,
  resolveCaptionLanguageMode
} from "@/lib/youtube/video-helpers";
import {
  type AdaptiveFormatItem,
  AudioTrackLanguageMode,
  type CaptionTrack,
  type Options,
  PanelTrackMode,
  type Prettify,
  type VideoData
} from "@/types";

export function getActivePlayerCaption() {
  const stored = getMoviePlayer()?.getAttribute(ACTIVE_CAPTION_ATTR);
  if (!stored) {
    return null;
  }

  try {
    const track: unknown = JSON.parse(stored);
    return isPlayerCaptionTrackData(track) ? track : null;
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

  const isEveryTrackAsr = videoData.captionTracks.every(track => track.kind === CAPTION_KIND_ASR);
  const candidateTracks = options.includeAiCaptions || isEveryTrackAsr
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
