import {
  getCurrentVideoAudioLanguage,
  normalizeLanguageCode,
  selectPreferredAudioFormat,
  sortAudioFormatsByDisplayName
} from "@/lib/youtube/video-helpers";
import {
  AudioTrackLanguageMode,
  PanelTrackMode,
  type AdaptiveFormatItem,
  type Options,
  type VideoData
} from "@/types";

const IS_WATCH_PAGE = location.pathname === "/watch";

export { IS_WATCH_PAGE };

export function getPreferredMusicAudioFormat(audioFormats: AdaptiveFormatItem[]) {
  return audioFormats.find(format => format.mimeType.includes("mp4")) ?? audioFormats[0] ?? null;
}

export function resolveInitialAudioFormat({ options, videoData }: {
  options: Options;
  videoData: VideoData;
}) {
  if (videoData.isMusic) {
    return getPreferredMusicAudioFormat(videoData.audioFormats);
  }

  if (IS_WATCH_PAGE) {
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

export function resolveInitialAudioMode({ options, videoData }: {
  options: Options;
  videoData: VideoData;
}) {
  const isCustomMode = options.audioTrackLanguageMode === AudioTrackLanguageMode.Custom;
  const isCustomWithLanguage = isCustomMode && options.customLanguage;
  if (isCustomWithLanguage) {
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

export function resolveInitialAudioCustomLanguage({ options, videoData }: {
  options: Options;
  videoData: VideoData;
}) {
  const isCustomMode = options.audioTrackLanguageMode === AudioTrackLanguageMode.Custom;
  const isCustomWithLanguage = isCustomMode && options.customLanguage;
  if (isCustomWithLanguage) {
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
