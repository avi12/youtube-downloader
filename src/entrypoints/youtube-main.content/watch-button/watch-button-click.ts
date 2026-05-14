import { performDownload } from "../video/download";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";
import { DownloadType, type TpYtIronDropdownElement, type VideoData, type YtButtonViewModelElement } from "@/types";

export interface ClickHandlerState {
  getIsDownloading(): boolean;
  getIsInterrupted(): boolean;
  getIsPanelOpen(): boolean;
  getDefaultDownloadType(): DownloadType;
  getDefaultVideoItag(): number;
  getDefaultAudioItag(): number;
  getDefaultAudioTrackId(): string | undefined;
  getDefaultFilename(): string;
  getElDownloadButton(): YtButtonViewModelElement | null;
  getElChevronButton(): YtButtonViewModelElement | null;
  setIsDownloading(value: boolean): void;
  setIsInterrupted(value: boolean): void;
  setIsDone(value: boolean): void;
  setIsError(value: boolean): void;
  setIsPanelOpen(value: boolean): void;
}

export function buildClickHandler(
  videoData: VideoData,
  elDropdown: TpYtIronDropdownElement,
  state: ClickHandlerState
) {
  return function handleClick(e: Event) {
    const { target } = e;
    if (!(target instanceof Node)) {
      return;
    }

    const elDownloadButton = state.getElDownloadButton();
    if (elDownloadButton?.contains(target)) {
      if (!videoData.isDownloadable) {
        return;
      }

      if (state.getIsDownloading() || state.getIsInterrupted()) {
        state.setIsDownloading(false);
        state.setIsInterrupted(false);
        void crossWorldMessenger.sendMessage(CrossWorldMessage.CancelDownload, {
          videoIds: [videoData.videoId]
        });
        return;
      }

      state.setIsDone(false);
      state.setIsInterrupted(false);
      state.setIsError(false);
      void performDownload({
        type: state.getDefaultDownloadType(),
        videoId: videoData.videoId,
        videoItag: state.getDefaultVideoItag(),
        audioItag: state.getDefaultAudioItag(),
        audioTrackId: state.getDefaultAudioTrackId(),
        filenameOutput: state.getDefaultFilename()
      });
      return;
    }

    const elChevronButton = state.getElChevronButton();
    if (elChevronButton?.contains(target)) {
      if (!videoData.isDownloadable) {
        return;
      }

      const isNowOpen = !state.getIsPanelOpen();
      state.setIsPanelOpen(isNowOpen);

      if (isNowOpen) {
        e.stopPropagation();
        elDropdown.open();
        elChevronButton.querySelector<HTMLButtonElement>("button")?.blur();
      } else {
        elDropdown.close();
      }
    }
  };
}
