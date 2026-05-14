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
  type CaptionTrack,
  type Options,
  type VideoData
} from "@/types";

export function getActivePlayerCaption() {
  const elPlayer = document.querySelector<MoviePlayerElement>("#movie_player");
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

export function resolveInitialCaptionMode(options: Options, videoData: VideoData) {
  const resolvedMode = resolveCaptionLanguageMode(options.captionLanguageMode, options.audioTrackLanguageMode);
  if (resolvedMode === AudioTrackLanguageMode.OriginalLanguage) {
    return PanelTrackMode.Original;
  }

  if (resolvedMode === AudioTrackLanguageMode.Custom && options.customLanguage) {
    const langCode = normalizeLanguageCode(options.customLanguage);
    const hasMatch = videoData.captionTracks.some(track => normalizeLanguageCode(track.languageCode) === langCode);
    if (hasMatch) {
      return PanelTrackMode.Custom;
    }
  }

  return PanelTrackMode.MatchVideo;
}

export function resolveInitialCaptionTrack(
  captionMode: PanelTrackMode,
  options: Options,
  videoData: VideoData
): CaptionTrack | null {
  if (!videoData.captionTracks.length) {
    return null;
  }

  if (captionMode === PanelTrackMode.Custom) {
    const langCode = normalizeLanguageCode(options.customLanguage ?? "");
    return videoData.captionTracks.find(track => normalizeLanguageCode(track.languageCode) === langCode)
      ?? videoData.captionTracks[0]
      ?? null;
  }

  if (captionMode === PanelTrackMode.Original) {
    const originalLangId = findOriginalAudioFormat(videoData.audioFormats)?.audioTrack?.id;
    if (originalLangId) {
      const langCode = normalizeLanguageCode(originalLangId);
      const match = videoData.captionTracks.find(
        track => normalizeLanguageCode(track.languageCode) === langCode && !track.kind
      ) ?? videoData.captionTracks.find(track => normalizeLanguageCode(track.languageCode) === langCode);
      if (match) {
        return match;
      }
    }

    return videoData.captionTracks.find(track => !track.kind) ?? videoData.captionTracks[0] ?? null;
  }

  const activeCaption = getActivePlayerCaption();
  if (activeCaption) {
    const match = videoData.captionTracks.find(track => track.vssId === activeCaption.vss_id)
      ?? videoData.captionTracks.find(
        track => normalizeLanguageCode(track.languageCode) === normalizeLanguageCode(activeCaption.languageCode)
      );
    if (match) {
      return match;
    }
  }

  return orderCaptionsByPreference({
    captionTracks: videoData.captionTracks,
    languageMode: AudioTrackLanguageMode.MatchYouTube,
    locale: document.documentElement.lang,
    browserLanguage: navigator.language
  })[0] ?? null;
}
