import { CAPTION_KIND_ASR } from "./helpers/audio-language-helpers";
import { IS_WATCH_PAGE } from "./helpers/panel-init-audio";
import { getActivePlayerCaption } from "./helpers/panel-init-caption";
import { PLAYER_ACTIVE_CAPTION } from "./helpers/player-active-tracks.svelte";
import { CONTENT_OPTIONS } from "@/lib/ui/synced-stores.svelte";
import {
  findOriginalAudioFormat,
  normalizeLanguageCode,
  orderCaptionsByPreference,
  resolveCaptionLanguageMode
} from "@/lib/youtube/video-helpers";
import { AudioTrackLanguageMode, PanelTrackMode, type CaptionTrack, type VideoData } from "@/types";
import { untrack } from "svelte";

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
      if (IS_WATCH_PAGE) {
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

      selectedCaptionTrack = orderCaptionsByPreference({
        captionTracks,
        languageMode: AudioTrackLanguageMode.MatchYouTube,
        locale: document.documentElement.lang,
        browserLanguage: navigator.language
      })[0] ?? null;
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
    const { captionLanguageMode, audioTrackLanguageMode, customLanguage } = CONTENT_OPTIONS;

    untrack(() => {
      const resolvedMode = resolveCaptionLanguageMode({
        captionMode: captionLanguageMode,
        audioMode: audioTrackLanguageMode
      });      if (resolvedMode === AudioTrackLanguageMode.OriginalLanguage) {
        handlePanelCaptionModeChange(PanelTrackMode.Original);
        return;
      }

      const isCustomModeWithLanguage = resolvedMode === AudioTrackLanguageMode.Custom && customLanguage;
      if (isCustomModeWithLanguage) {
        const langCode = normalizeLanguageCode(customLanguage);
        const { captionTracks } = getVideoData();
        const manualTracks = captionTracks.filter(track => !track.kind);
        const candidates = manualTracks.length > 0 ? manualTracks : captionTracks;
        const match = candidates.find(track => normalizeLanguageCode(track.languageCode) === langCode)
          ?? captionTracks.find(track => normalizeLanguageCode(track.languageCode) === langCode)
          ?? null;
        if (match) {
          handlePanelCaptionModeChange(PanelTrackMode.Custom);
          selectedCaptionTrack = match;
          return;
        }
      }

      handlePanelCaptionModeChange(PanelTrackMode.MatchVideo);
    });
  });

  $effect(() => {
    const { vssId, languageCode } = PLAYER_ACTIVE_CAPTION;
    const isTrackSyncSkipped = !IS_WATCH_PAGE || (!vssId && !languageCode);
    if (isTrackSyncSkipped) {
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
    const isPlayerCaptionIgnored = !isMatchVideo && !isOnlyAsrAvailable;
    if (isPlayerCaptionIgnored) {
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
