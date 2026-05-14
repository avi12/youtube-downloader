import { getActivePlayerCaption } from "./panel-init-caption";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";
import { findOriginalAudioFormat, normalizeLanguageCode } from "@/lib/youtube/video-helpers";
import { PanelTrackMode, type CaptionTrack, type VideoData } from "@/types";

export function createCaptionTrackState(
  getVideoData: () => VideoData,
  initialMode: PanelTrackMode,
  initialTrack: CaptionTrack | null
) {
  let panelCaptionMode = $state<PanelTrackMode>(initialMode);
  let selectedCaptionTrack = $state<CaptionTrack | null>(initialTrack);

  function handlePanelCaptionModeChange(newMode: PanelTrackMode) {
    panelCaptionMode = newMode;
    const { captionTracks } = getVideoData();
    if (newMode === PanelTrackMode.MatchVideo) {
      const activeCaption = getActivePlayerCaption();
      selectedCaptionTrack = activeCaption
        ? captionTracks.find(track => track.vssId === activeCaption.vss_id)
          ?? captionTracks.find(
            track => normalizeLanguageCode(track.languageCode) === normalizeLanguageCode(activeCaption.languageCode)
          )
          ?? null
        : null;
      return;
    }

    if (newMode === PanelTrackMode.Original) {
      const { audioFormats } = getVideoData();
      const originalAudio = findOriginalAudioFormat(audioFormats);
      if (originalAudio?.audioTrack) {
        const langCode = normalizeLanguageCode(originalAudio.audioTrack.id);
        selectedCaptionTrack =
          captionTracks.find(track => normalizeLanguageCode(track.languageCode) === langCode) ?? null;
      } else {
        selectedCaptionTrack = captionTracks[0] ?? null;
      }

      return;
    }

    if (!selectedCaptionTrack && captionTracks.length > 0) {
      selectedCaptionTrack = captionTracks[0];
    }
  }

  function handleCaptionChange(track: CaptionTrack | null) {
    selectedCaptionTrack = track;
  }

  $effect(() => crossWorldMessenger.onMessage(CrossWorldMessage.CaptionTrackChanged, ({ data }) => {
    if (panelCaptionMode !== PanelTrackMode.MatchVideo) {
      return;
    }

    const { captionTracks } = getVideoData();
    const match = captionTracks.find(track => track.vssId === data.vssId)
      ?? captionTracks.find(
        track => normalizeLanguageCode(track.languageCode) === normalizeLanguageCode(data.languageCode)
      );
    if (!match) {
      return;
    }

    selectedCaptionTrack = match;
  }));

  return {
    get panelCaptionMode() {
      return panelCaptionMode;
    },
    get selectedCaptionTrack() {
      return selectedCaptionTrack;
    },
    set selectedCaptionTrack(value: CaptionTrack | null) {
      selectedCaptionTrack = value;
    },
    handlePanelCaptionModeChange,
    handleCaptionChange
  };
}
