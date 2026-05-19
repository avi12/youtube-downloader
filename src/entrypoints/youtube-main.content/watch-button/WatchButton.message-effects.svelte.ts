import { handleProgressUpdate, type ProgressUpdateHandlers } from "./watch-button-progress";
import { CrossWorldEvent, onCrossWorldEvent } from "@/lib/messaging/cross-world-messenger";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";
import type { TpYtIronDropdownElement } from "@/types";

export interface MessageEffectsSetters {
  setDefaultFilename(value: string): void;
  setDefaultQuality(value: string): void;
  setDefaultVideoItag(value: number): void;
  setDefaultAudioItag(value: number): void;
  setDefaultAudioTrackId(value: string | undefined): void;
}

export function createMessageEffects({ videoId, handlers, getIsPanelOpen, setIsPanelOpen, setters, getElDropdown }: {
  videoId: string;
  handlers: ProgressUpdateHandlers;
  getIsPanelOpen: () => boolean;
  setIsPanelOpen: (value: boolean) => void;
  setters: MessageEffectsSetters;
  getElDropdown: () => TpYtIronDropdownElement;
}) {
  $effect(() => onCrossWorldEvent({
    type: CrossWorldEvent.ProgressUpdate,
    handler(data) {
      handleProgressUpdate({
        data,
        videoId,
        handlers
      });
    }
  }));

  $effect(() => crossWorldMessenger.onMessage(CrossWorldMessage.PanelClosed, () => {
    const isPanelClosed = !getIsPanelOpen();
    if (isPanelClosed) {
      return;
    }

    setIsPanelOpen(false);
    getElDropdown().close();
  }));

  $effect(() => crossWorldMessenger.onMessage(CrossWorldMessage.FilenameChanged, ({ data }) => {
    setters.setDefaultFilename(data.filename);
    setters.setDefaultQuality(data.quality ?? "");

    const hasVideoItag = data.videoItag !== undefined;
    if (hasVideoItag) {
      setters.setDefaultVideoItag(data.videoItag!);
    }

    const hasAudioItag = data.audioItag !== undefined;
    if (hasAudioItag) {
      setters.setDefaultAudioItag(data.audioItag!);
    }

    const hasAudioTrackId = data.audioTrackId !== undefined;
    if (hasAudioTrackId) {
      setters.setDefaultAudioTrackId(data.audioTrackId);
    }
  }));
}
