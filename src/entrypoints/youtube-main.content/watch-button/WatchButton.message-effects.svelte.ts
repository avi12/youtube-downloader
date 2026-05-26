import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";
import type { TpYtIronDropdownElement } from "@/types";

export interface MessageEffectsSetters {
  setDefaultFilename(value: string): void;
  setDefaultQuality(value: string): void;
  setDefaultVideoItag(value: number): void;
  setDefaultAudioItag(value: number): void;
  setDefaultAudioTrackId(value: string | undefined): void;
}

type CreateMessageEffectsParams = {
  getIsPanelOpen: () => boolean;
  setIsPanelOpen: (value: boolean) => void;
  setters: MessageEffectsSetters;
  getElDropdown: () => TpYtIronDropdownElement;
};
export function createMessageEffects({
  getIsPanelOpen, setIsPanelOpen, setters, getElDropdown
}: CreateMessageEffectsParams) {
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

    const isVideoItagPresent = data.videoItag !== undefined;
    if (isVideoItagPresent) {
      setters.setDefaultVideoItag(data.videoItag!);
    }

    const isAudioItagPresent = data.audioItag !== undefined;
    if (isAudioItagPresent) {
      setters.setDefaultAudioItag(data.audioItag!);
    }

    const isAudioTrackIdPresent = data.audioTrackId !== undefined;
    if (isAudioTrackIdPresent) {
      setters.setDefaultAudioTrackId(data.audioTrackId);
    }
  }));
}
