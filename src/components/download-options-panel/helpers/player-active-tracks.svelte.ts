import { getActivePlayerCaption } from "./panel-init-caption";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";

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
