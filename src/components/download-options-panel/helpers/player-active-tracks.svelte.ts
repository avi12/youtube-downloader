import { AUTO_DUB_TRACK_SUFFIX } from "./audio-language-helpers";
import { getActivePlayerCaption } from "./panel-init-caption";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";
import { ACTIVE_AUDIO_ATTR } from "@/lib/youtube/movie-player";
import { getCurrentVideoAudioLanguage, normalizeLanguageCode } from "@/lib/youtube/video-helpers";
import type { AdaptiveFormatItem } from "@/types";

const MOVIE_PLAYER_SELECTOR = "#movie_player";

function getInitialPlayerAudioTrackId() {
  return document.querySelector(MOVIE_PLAYER_SELECTOR)?.getAttribute(ACTIVE_AUDIO_ATTR) || null;
}

const initialCaption = getActivePlayerCaption();

export const PLAYER_ACTIVE_CAPTION = $state<{
  vssId: string | null;
  languageCode: string | null;
}>({
  vssId: initialCaption?.vss_id ?? null,
  languageCode: initialCaption?.languageCode ?? null
});

crossWorldMessenger.onMessage(CrossWorldMessage.CaptionTrackChanged, ({ data }) => {
  PLAYER_ACTIVE_CAPTION.vssId = data.vssId || null;
  PLAYER_ACTIVE_CAPTION.languageCode = data.languageCode || null;
});

const initialAudioTrackId = getInitialPlayerAudioTrackId();

export const PLAYER_ACTIVE_AUDIO = $state<{
  trackId: string | null;
  langCode: string | null;
  isAutoDubbed: boolean;
}>({
  trackId: initialAudioTrackId,
  langCode: initialAudioTrackId ? normalizeLanguageCode(initialAudioTrackId) : getCurrentVideoAudioLanguage(),
  isAutoDubbed: initialAudioTrackId?.endsWith(AUTO_DUB_TRACK_SUFFIX) ?? false
});

crossWorldMessenger.onMessage(CrossWorldMessage.AudioTrackChanged, ({ data }) => {
  PLAYER_ACTIVE_AUDIO.trackId = data.trackId || null;
  PLAYER_ACTIVE_AUDIO.langCode = data.trackId ? normalizeLanguageCode(data.trackId) : null;
  PLAYER_ACTIVE_AUDIO.isAutoDubbed = data.trackId.endsWith(AUTO_DUB_TRACK_SUFFIX);
});

export function syncAudioFromFormat(format: AdaptiveFormatItem | null) {
  if (PLAYER_ACTIVE_AUDIO.trackId || !format?.audioTrack) {
    return;
  }

  PLAYER_ACTIVE_AUDIO.trackId = format.audioTrack.id;
  PLAYER_ACTIVE_AUDIO.langCode = normalizeLanguageCode(format.audioTrack.id);
  PLAYER_ACTIVE_AUDIO.isAutoDubbed = format.audioTrack.id.endsWith(AUTO_DUB_TRACK_SUFFIX);
}
