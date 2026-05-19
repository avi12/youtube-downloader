import { CAPTION_KIND_ASR } from "./helpers/audio-language-helpers";
import { getActivePlayerCaption } from "./helpers/panel-init-caption";
import { PLAYER_ACTIVE_CAPTION } from "./helpers/player-active-tracks.svelte";
import { findOriginalAudioFormat, normalizeLanguageCode } from "@/lib/youtube/video-helpers";
import { PanelTrackMode, type CaptionTrack, type VideoData } from "@/types";

export function createCaptionTrackState({
  getVideoData,
  initialMode,
  initialTrack
}: {
  getVideoData: () => VideoData;
  initialMode: PanelTrackMode;
  initialTrack: CaptionTrack | null;
}) {
  let panelCaptionMode = $state<PanelTrackMode>(initialMode);
  let selectedCaptionTrack = $state<CaptionTrack | null>(initialTrack);

  function handlePanelCaptionModeChange(newMode: PanelTrackMode) {
    panelCaptionMode = newMode;
    const { captionTracks } = getVideoData();
    const isMatchVideoMode = newMode === PanelTrackMode.MatchVideo;
    if (isMatchVideoMode) {
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

    const isOriginalMode = newMode === PanelTrackMode.Original;
    if (isOriginalMode) {
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

    const isCustomModeWithNoTrack = !selectedCaptionTrack && captionTracks.length > 0;
    if (isCustomModeWithNoTrack) {
      selectedCaptionTrack = captionTracks[0];
    }
  }

  function handleCaptionChange(track: CaptionTrack | null) {
    selectedCaptionTrack = track;
  }

  $effect(() => {
    const { vssId, languageCode } = PLAYER_ACTIVE_CAPTION;
    if (!vssId && !languageCode) {
      return;
    }

    const { captionTracks } = getVideoData();
    const match = captionTracks.find(track => track.vssId === vssId)
      ?? (languageCode
        ? captionTracks.find(track => normalizeLanguageCode(track.languageCode) === normalizeLanguageCode(languageCode))
        : undefined);
    if (!match) {
      return;
    }

    const isMatchVideo = panelCaptionMode === PanelTrackMode.MatchVideo;
    const isOnlyAsrAvailable = captionTracks.every(track => track.kind === CAPTION_KIND_ASR);
    if (!isMatchVideo && !isOnlyAsrAvailable) {
      return;
    }

    selectedCaptionTrack = match;
  });

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
