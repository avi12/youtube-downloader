import { getActivePlayerCaption } from "./panel-init-caption";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";
import { getCurrentVideoAudioLanguage, normalizeLanguageCode } from "@/lib/youtube/video-helpers";

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

export const PLAYER_ACTIVE_AUDIO = $state<{
  trackId: string | null;
  langCode: string | null;
  isAutoDubbed: boolean;
}>({
  trackId: null,
  langCode: getCurrentVideoAudioLanguage(),
  isAutoDubbed: false
});

crossWorldMessenger.onMessage(CrossWorldMessage.AudioTrackChanged, ({ data }) => {
  PLAYER_ACTIVE_AUDIO.trackId = data.trackId || null;
  PLAYER_ACTIVE_AUDIO.langCode = data.trackId ? normalizeLanguageCode(data.trackId) : null;
  PLAYER_ACTIVE_AUDIO.isAutoDubbed = data.trackId.endsWith(".10");
});
