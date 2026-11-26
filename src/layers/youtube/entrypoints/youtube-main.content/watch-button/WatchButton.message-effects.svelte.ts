import { required } from "@/lib/required";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";
import type { CodecPreferences, DownloadType, Prettify, TpYtIronDropdownElement } from "@/types";
import { isFilenameChangedPayload } from "#youtube/lib/messaging/payload-guards";

export type MessageEffectsSetters = Prettify<{
  setDefaultFilename(value: string): void;
  setDefaultQuality(value: string): void;
  setDefaultVideoItag(value: number): void;
  setDefaultAudioItag(value: number): void;
  setDefaultAudioTrackId(value: string | undefined): void;
  setDefaultCodecPreferences(value: CodecPreferences | undefined): void;
  setDefaultDownloadType(value: DownloadType): void;
}>;

type CreateMessageEffectsParams = Prettify<{
  getIsPanelOpen: () => boolean;
  setIsPanelOpen: (value: boolean) => void;
  setters: MessageEffectsSetters;
  getElDropdown: () => TpYtIronDropdownElement;
}>;
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
    if (!isFilenameChangedPayload(data)) {
      return;
    }

    setters.setDefaultFilename(data.filename);
    setters.setDefaultQuality(data.quality ?? "");

    const isVideoItagPresent = data.videoItag !== undefined;
    if (isVideoItagPresent) {
      setters.setDefaultVideoItag(required(data.videoItag));
    }

    const isAudioItagPresent = data.audioItag !== undefined;
    if (isAudioItagPresent) {
      setters.setDefaultAudioItag(required(data.audioItag));
    }

    const isAudioTrackIdPresent = data.audioTrackId !== undefined;
    if (isAudioTrackIdPresent) {
      setters.setDefaultAudioTrackId(data.audioTrackId);
    }

    setters.setDefaultCodecPreferences(data.codecPreferences);

    const isDownloadTypePresent = data.downloadType !== undefined;
    if (isDownloadTypePresent) {
      setters.setDefaultDownloadType(required(data.downloadType));
    }
  }));
}
