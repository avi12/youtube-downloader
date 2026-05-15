import { getActivePlayerCaption } from "./panel-init-caption";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";

const initial = getActivePlayerCaption();

export const PLAYER_ACTIVE_CAPTION = $state<{
  languageCode: string | null;
  vssId: string | null;
}>({
  languageCode: initial?.languageCode ?? null,
  vssId: initial?.vss_id ?? null
});

crossWorldMessenger.onMessage(CrossWorldMessage.CaptionTrackChanged, ({ data }) => {
  PLAYER_ACTIVE_CAPTION.languageCode = data.languageCode || null;
  PLAYER_ACTIVE_CAPTION.vssId = data.vssId || null;
});
