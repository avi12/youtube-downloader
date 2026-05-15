import { findAudioFormatForPlayerTrack } from "./panel-audio-actions";
import { PLAYER_ACTIVE_AUDIO } from "./player-active-tracks.svelte";
import {
  findOriginalAudioFormat,
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
    const playerTrackId = PLAYER_ACTIVE_AUDIO.trackId;
    if (playerTrackId) {
      const match = findAudioFormatForPlayerTrack({
        audioFormats: videoData.audioFormats,
        trackId: playerTrackId,
        langCode: normalizeLanguageCode(playerTrackId)
      });
      if (match) {
        return match;
      }
    }

    // Video not loaded yet (e.g. an ad is playing): the user can't see the real
    // audio tracks, so default to the original one. The match-video effect
    // re-selects once the player reports its active track.
    const original = findOriginalAudioFormat(videoData.audioFormats);
    if (original) {
      return original;
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

function findMatchedCustomLangCode({ options, audioFormats }: {
  options: Options;
  audioFormats: AdaptiveFormatItem[];
}) {
  const isCustomMode = options.audioTrackLanguageMode === AudioTrackLanguageMode.Custom;
  if (!isCustomMode || !options.customLanguage) {
    return null;
  }

  const langCode = normalizeLanguageCode(options.customLanguage);
  const hasMatch = audioFormats.some(
    format => format.audioTrack && normalizeLanguageCode(format.audioTrack.id) === langCode
  );
  return hasMatch ? langCode : null;
}

export function resolveInitialAudioMode({ options, videoData }: {
  options: Options;
  videoData: VideoData;
}) {
  const customLangCode = findMatchedCustomLangCode({
    options,
    audioFormats: videoData.audioFormats
  });
  return customLangCode ? PanelTrackMode.Custom : PanelTrackMode.MatchVideo;
}

export function resolveInitialAudioCustomLanguage({ options, videoData }: {
  options: Options;
  videoData: VideoData;
}) {
  const customLangCode = findMatchedCustomLangCode({
    options,
    audioFormats: videoData.audioFormats
  });
  if (customLangCode) {
    return customLangCode;
  }

  const firstTrack = sortAudioFormatsByDisplayName(videoData.audioFormats)[0];
  return firstTrack?.audioTrack ? normalizeLanguageCode(firstTrack.audioTrack.id) : "";
}
