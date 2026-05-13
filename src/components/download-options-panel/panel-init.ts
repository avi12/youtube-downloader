import { getCompatibleFilename, resolveAutoExtension } from "@/lib/utils/containers";
import { ACTIVE_CAPTION_ATTR, isPlayerCaptionTrackData } from "@/lib/youtube/movie-player";
import type { MoviePlayerElement } from "@/lib/youtube/movie-player";
import {
  findOriginalAudioFormat,
  getCurrentVideoAudioLanguage,
  normalizeLanguageCode,
  orderCaptionsByPreference,
  resolveCaptionLanguageMode,
  selectPreferredAudioFormat,
  sortAudioFormatsByDisplayName
} from "@/lib/youtube/video-helpers";
import {
  AudioTrackLanguageMode,
  DownloadType,
  PanelTrackMode,
  type AdaptiveFormatItem,
  type CaptionTrack,
  type Options,
  type VideoData
} from "@/types";

const IS_WATCH_PAGE = location.pathname === "/watch";

export function getPreferredMusicAudioFormat(audioFormats: AdaptiveFormatItem[]) {
  return audioFormats.find(format => format.mimeType.includes("mp4")) ?? audioFormats[0] ?? null;
}

export function resolveInitialDownloadType(options: Options, videoData: VideoData) {
  if (options.defaultDownloadType !== DownloadType.Auto) {
    return options.defaultDownloadType;
  }

  return videoData.isMusic ? DownloadType.Audio : DownloadType.VideoAndAudio;
}

export function resolveInitialAudioFormat(options: Options, videoData: VideoData) {
  if (videoData.isMusic) {
    return getPreferredMusicAudioFormat(videoData.audioFormats);
  }

  if (options.audioTrackLanguageMode === AudioTrackLanguageMode.MatchVideo && IS_WATCH_PAGE) {
    const currentLang = getCurrentVideoAudioLanguage();
    if (currentLang) {
      const matching = videoData.audioFormats.filter(
        format => format.audioTrack && normalizeLanguageCode(format.audioTrack.id) === currentLang
      );
      if (matching.length) {
        return matching.reduce((best, format) => format.bitrate > best.bitrate ? format : best);
      }
    }
  }

  return selectPreferredAudioFormat({
    audioFormats: videoData.audioFormats,
    videoMimeType: videoData.videoFormats[0]?.mimeType ?? "",
    languageMode: options.audioTrackLanguageMode,
    locale: document.documentElement.lang,
    browserLanguage: navigator.language,
    customLanguage: options.customLanguage
  });
}

export function resolveInitialAudioMode(options: Options, videoData: VideoData) {
  if (options.audioTrackLanguageMode === AudioTrackLanguageMode.OriginalLanguage) {
    return PanelTrackMode.Original;
  }

  if (options.audioTrackLanguageMode === AudioTrackLanguageMode.Custom && options.customLanguage) {
    const langCode = normalizeLanguageCode(options.customLanguage);
    const hasMatch = videoData.audioFormats.some(
      format => format.audioTrack && normalizeLanguageCode(format.audioTrack.id) === langCode
    );
    if (hasMatch) {
      return PanelTrackMode.Custom;
    }
  }

  return PanelTrackMode.MatchVideo;
}

export function resolveInitialAudioCustomLanguage(options: Options, videoData: VideoData) {
  if (options.audioTrackLanguageMode === AudioTrackLanguageMode.Custom && options.customLanguage) {
    const langCode = normalizeLanguageCode(options.customLanguage);
    const hasMatch = videoData.audioFormats.some(
      format => format.audioTrack && normalizeLanguageCode(format.audioTrack.id) === langCode
    );
    if (hasMatch) {
      return langCode;
    }
  }

  const firstTrack = sortAudioFormatsByDisplayName(videoData.audioFormats)[0];
  return firstTrack?.audioTrack ? normalizeLanguageCode(firstTrack.audioTrack.id) : "";
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

export function resolveInitialExtension(options: Options, videoData: VideoData) {
  const extensionPreference = videoData.isMusic ? options.ext.audio : options.ext.video;
  const defaultFormat = videoData.isMusic
    ? getPreferredMusicAudioFormat(videoData.audioFormats)
    : videoData.videoFormats[0];
  return resolveAutoExtension({
    extension: extensionPreference,
    mimeType: defaultFormat?.mimeType ?? ""
  });
}

export function resolveInitialFilename(videoData: VideoData) {
  return getCompatibleFilename(videoData.title || videoData.videoId);
}

export { IS_WATCH_PAGE };
