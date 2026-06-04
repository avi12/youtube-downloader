import { findAudioFormatForPlayerTrack, findMatchVideoAudioFormat } from "./helpers/panel-audio-actions";
import { IS_WATCH_PAGE } from "./helpers/panel-init-audio";
import { PLAYER_ACTIVE_AUDIO } from "./helpers/player-active-tracks.svelte";
import { CONTENT_OPTIONS } from "@/lib/ui/synced-stores.svelte";
import {
  findOriginalAudioFormat,
  normalizeLanguageCode,
  selectPreferredAudioFormat
} from "@/lib/youtube/video-helpers";
import { AudioTrackLanguageMode, PanelTrackMode, type AdaptiveFormatItem, type VideoData } from "@/types";
import { untrack } from "svelte";

export function createAudioTrackState({
  getVideoData,
  setSelectedAudioFormat,
  initialMode,
  initialCustomLanguage
}: {
  getVideoData: () => VideoData;
  setSelectedAudioFormat: (value: AdaptiveFormatItem | null) => void;
  initialMode: PanelTrackMode;
  initialCustomLanguage: string;
}) {
  let panelAudioMode = $state<PanelTrackMode>(initialMode);
  let panelAudioCustomLanguage = $state(initialCustomLanguage);

  function applyAudioByLangCode(langCode: string) {
    const { audioFormats } = getVideoData();
    const matching = audioFormats.filter(
      format => format.audioTrack && normalizeLanguageCode(format.audioTrack.id) === langCode
    );
    if (matching.length) {
      setSelectedAudioFormat(matching.reduce((best, format) => format.bitrate > best.bitrate ? format : best));
    }
  }

  function handlePanelAudioModeChange(newMode: PanelTrackMode) {
    panelAudioMode = newMode;

    const isOriginalMode = newMode === PanelTrackMode.Original;
    if (isOriginalMode) {
      const { audioFormats } = getVideoData();
      const original = findOriginalAudioFormat(audioFormats);
      if (original) {
        setSelectedAudioFormat(original);
      }

      return;
    }

    const isCustomMode = newMode === PanelTrackMode.Custom;
    if (isCustomMode) {
      if (panelAudioCustomLanguage) {
        applyAudioByLangCode(panelAudioCustomLanguage);
      }

      return;
    }

    const { audioFormats: matchAudioFormats, videoFormats } = getVideoData();
    const matchDefault = IS_WATCH_PAGE
      ? findMatchVideoAudioFormat(matchAudioFormats)
      : selectPreferredAudioFormat({
        audioFormats: matchAudioFormats,
        videoMimeType: videoFormats[0]?.mimeType ?? "",
        languageMode: AudioTrackLanguageMode.MatchYouTube,
        locale: document.documentElement.lang,
        browserLanguage: navigator.language
      });
    if (matchDefault) {
      setSelectedAudioFormat(matchDefault);
    }
  }

  function handlePanelAudioCustomChange(langCode: string) {
    panelAudioCustomLanguage = langCode;
    applyAudioByLangCode(langCode);
  }

  $effect(() => {
    const { audioTrackLanguageMode, customLanguage } = CONTENT_OPTIONS;

    untrack(() => {
      const isOriginalLanguageMode = audioTrackLanguageMode === AudioTrackLanguageMode.OriginalLanguage;
      if (isOriginalLanguageMode) {
        handlePanelAudioModeChange(PanelTrackMode.Original);
        return;
      }

      const isCustomLanguageMode = audioTrackLanguageMode === AudioTrackLanguageMode.Custom;
      if (isCustomLanguageMode) {
        const langCode = normalizeLanguageCode(customLanguage);
        const { audioFormats } = getVideoData();
        const isMatchFound = audioFormats.some(
          format => format.audioTrack && normalizeLanguageCode(format.audioTrack.id) === langCode
        );
        if (isMatchFound) {
          panelAudioCustomLanguage = langCode;
          handlePanelAudioModeChange(PanelTrackMode.Custom);
          return;
        }
      }

      handlePanelAudioModeChange(PanelTrackMode.MatchVideo);
    });
  });

  $effect(() => {
    const { trackId: playerTrackId, langCode: playerLangCode } = PLAYER_ACTIVE_AUDIO;
    const isMatchVideo = panelAudioMode === PanelTrackMode.MatchVideo;
    const isAudioSyncSkipped = !IS_WATCH_PAGE || !isMatchVideo || !playerLangCode;
    if (isAudioSyncSkipped) {
      return;
    }

    const match = findAudioFormatForPlayerTrack({
      audioFormats: getVideoData().audioFormats,
      trackId: playerTrackId,
      langCode: playerLangCode
    });
    if (match) {
      setSelectedAudioFormat(match);
    }
  });

  return {
    get panelAudioMode() {
      return panelAudioMode;
    },
    get panelAudioCustomLanguage() {
      return panelAudioCustomLanguage;
    },
    handlePanelAudioModeChange,
    handlePanelAudioCustomChange
  };
}
