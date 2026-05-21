import { findAudioFormatForPlayerTrack, findMatchVideoAudioFormat } from "./helpers/panel-audio-actions";
import { PLAYER_ACTIVE_AUDIO } from "./helpers/player-active-tracks.svelte";
import { findOriginalAudioFormat, normalizeLanguageCode } from "@/lib/youtube/video-helpers";
import { PanelTrackMode, type AdaptiveFormatItem, type VideoData } from "@/types";

export function createAudioTrackState({
  getVideoData,
  setSelectedAudioFormat,
  resetDoneState,
  initialMode,
  initialCustomLanguage
}: {
  getVideoData: () => VideoData;
  setSelectedAudioFormat: (value: AdaptiveFormatItem | null) => void;
  resetDoneState: () => void;
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
      resetDoneState();
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
        resetDoneState();
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

    const { audioFormats: matchAudioFormats } = getVideoData();
    const matchDefault = findMatchVideoAudioFormat(matchAudioFormats);
    if (matchDefault) {
      setSelectedAudioFormat(matchDefault);
      resetDoneState();
    }
  }

  function handlePanelAudioCustomChange(langCode: string) {
    panelAudioCustomLanguage = langCode;
    applyAudioByLangCode(langCode);
  }

  $effect(() => {
    const { trackId: playerTrackId, langCode: playerLangCode } = PLAYER_ACTIVE_AUDIO;
    const isMatchVideo = panelAudioMode === PanelTrackMode.MatchVideo;
    const isAudioSyncSkipped = !isMatchVideo || !playerLangCode;
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
