import { startDownload } from "../video/download";
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

export function buildClickHandler({ videoData, elDropdown, state }: {
  videoData: VideoData;
  elDropdown: TpYtIronDropdownElement;
  state: ClickHandlerState;
}) {
  return function handleClick(e: Event) {
    const { target } = e;
    const isNotNode = !(target instanceof Node);
    if (isNotNode) {
      return;
    }

    const elDownloadButton = state.getElDownloadButton();
    if (elDownloadButton?.contains(target)) {
      const isNotDownloadable = !videoData.isDownloadable;
      if (isNotDownloadable) {
        return;
      }

      const isActiveDownload = state.getIsDownloading() || state.getIsInterrupted();
      if (isActiveDownload) {
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
      void startDownload({
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
      const isNotDownloadable = !videoData.isDownloadable;
      if (isNotDownloadable) {
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
