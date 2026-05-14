import { handleProgressUpdate, type ProgressUpdateHandlers } from "./watch-button-progress";
import { CrossWorldEvent, onCrossWorldEvent } from "@/lib/messaging/cross-world-events";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";
import type { TpYtIronDropdownElement } from "@/types";

export function createMessageEffects(
  videoId: string,
  handlers: ProgressUpdateHandlers,
  getIsPanelOpen: () => boolean,
  setIsPanelOpen: (value: boolean) => void,
  setDefaultFilename: (value: string) => void,
  setDefaultQuality: (value: string) => void,
  setDefaultVideoItag: (value: number) => void,
  setDefaultAudioItag: (value: number) => void,
  setDefaultAudioTrackId: (value: string | undefined) => void,
  getElDropdown: () => TpYtIronDropdownElement
) {
  $effect(() => onCrossWorldEvent({
    type: CrossWorldEvent.ProgressUpdate,
    handler(data) {
      handleProgressUpdate(data, videoId, handlers);
    }
  }));

  $effect(() => crossWorldMessenger.onMessage(CrossWorldMessage.PanelClosed, () => {
    if (!getIsPanelOpen()) {
      return;
    }

    setIsPanelOpen(false);
    getElDropdown().close();
  }));

  $effect(() => crossWorldMessenger.onMessage(CrossWorldMessage.FilenameChanged, ({ data }) => {
    setDefaultFilename(data.filename);
    setDefaultQuality(data.quality ?? "");

    if (data.videoItag !== undefined) {
      setDefaultVideoItag(data.videoItag);
    }

    if (data.audioItag !== undefined) {
      setDefaultAudioItag(data.audioItag);
    }

    if (data.audioTrackId !== undefined) {
      setDefaultAudioTrackId(data.audioTrackId);
    }
  }));
}
