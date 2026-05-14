import { findMatchVideoAudioFormat } from "./panel-audio-actions";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";
import { findOriginalAudioFormat, normalizeLanguageCode } from "@/lib/youtube/video-helpers";
import { PanelTrackMode, type AdaptiveFormatItem, type VideoData } from "@/types";

export function createAudioTrackState(
  getVideoData: () => VideoData,
  setSelectedAudioFormat: (value: AdaptiveFormatItem | null) => void,
  resetDoneState: () => void,
  initialMode: PanelTrackMode,
  initialCustomLanguage: string
) {
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

    if (newMode === PanelTrackMode.Original) {
      const { audioFormats } = getVideoData();
      const original = findOriginalAudioFormat(audioFormats);
      if (original) {
        setSelectedAudioFormat(original);
        resetDoneState();
      }

      return;
    }

    if (newMode === PanelTrackMode.Custom) {
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

  $effect(() => crossWorldMessenger.onMessage(CrossWorldMessage.AudioTrackChanged, ({ data }) => {
    if (panelAudioMode !== PanelTrackMode.MatchVideo) {
      return;
    }

    const { audioFormats } = getVideoData();
    const langCode = normalizeLanguageCode(data.trackId.split(".")[0]);
    const matching = audioFormats.filter(
      format => format.audioTrack && normalizeLanguageCode(format.audioTrack.id) === langCode
    );
    if (!matching.length) {
      return;
    }

    setSelectedAudioFormat(matching.reduce((best, format) => format.bitrate > best.bitrate ? format : best));
  }));

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
