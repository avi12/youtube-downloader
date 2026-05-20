import { CAPTION_KIND_ASR } from "./helpers/audio-language-helpers";
import { getActivePlayerCaption } from "./helpers/panel-init-caption";
import { PLAYER_ACTIVE_CAPTION } from "./helpers/player-active-tracks.svelte";
import { findOriginalAudioFormat, normalizeLanguageCode } from "@/lib/youtube/video-helpers";
import { PanelTrackMode, type CaptionTrack, type VideoData } from "@/types";

type FindCaptionTrackParams = {
  tracks: CaptionTrack[];
  vssId: string | null;
  languageCode: string | null;
};
function findCaptionTrack({ tracks, vssId, languageCode }: FindCaptionTrackParams) {
  const byVssId = vssId ? tracks.find(track => track.vssId === vssId) : undefined;
  const byLangCode = languageCode
    ? tracks.find(track => normalizeLanguageCode(track.languageCode) === normalizeLanguageCode(languageCode))
    : undefined;
  return byVssId ?? byLangCode ?? null;
}

type CreateCaptionTrackStateParams = {
  getVideoData: () => VideoData;
  initialMode: PanelTrackMode;
  initialTrack: CaptionTrack | null;
};
export function createCaptionTrackState({
  getVideoData,
  initialMode,
  initialTrack
}: CreateCaptionTrackStateParams) {
  let panelCaptionMode = $state<PanelTrackMode>(initialMode);
  let selectedCaptionTrack = $state<CaptionTrack | null>(initialTrack);

  function handlePanelCaptionModeChange(newMode: PanelTrackMode) {
    panelCaptionMode = newMode;
    const { captionTracks } = getVideoData();
    const isMatchVideoMode = newMode === PanelTrackMode.MatchVideo;
    if (isMatchVideoMode) {
      const activeCaption = getActivePlayerCaption();
      selectedCaptionTrack = activeCaption
        ? findCaptionTrack({
          tracks: captionTracks,
          vssId: activeCaption.vss_id,
          languageCode: activeCaption.languageCode
        })
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
    const match = findCaptionTrack({
      tracks: captionTracks,
      vssId,
      languageCode
    });
    if (!match) {
      return;
    }

    const isMatchVideo = panelCaptionMode === PanelTrackMode.MatchVideo;
    const isOnlyAsrAvailable = captionTracks.every(track => track.kind === CAPTION_KIND_ASR);
    const shouldIgnorePlayerCaption = !isMatchVideo && !isOnlyAsrAvailable;
    if (shouldIgnorePlayerCaption) {
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
