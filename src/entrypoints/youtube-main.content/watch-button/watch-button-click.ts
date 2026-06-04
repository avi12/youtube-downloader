import { cancelActiveDownload, startDownload } from "../video/download";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";
import { downloadProgressStore } from "@/lib/ui/synced-stores.svelte";
import {
  DownloadType,
  type Prettify,
  type TpYtIronDropdownElement,
  type VideoData,
  type YtButtonViewModelElement
} from "@/types";

export type ClickHandlerState = Prettify<{
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
  setIsPanelOpen(value: boolean): void;
}>;

type BuildClickHandlerParams = Prettify<{
  videoData: VideoData;
  elDropdown: TpYtIronDropdownElement;
  state: ClickHandlerState;
}>;
export function buildClickHandler({ videoData, elDropdown, state }: BuildClickHandlerParams) {
  return function handleClick(e: Event) {
    const { target } = e;
    const isNode = target instanceof Node;
    if (!isNode) {
      return;
    }

    const elDownloadButton = state.getElDownloadButton();
    const isDownloadButtonClicked = !!elDownloadButton?.contains(target);
    if (isDownloadButtonClicked) {
      const isDownloadable = videoData.isDownloadable;
      if (!isDownloadable) {
        return;
      }

      const isActiveDownload = state.getIsDownloading() || state.getIsInterrupted();
      if (isActiveDownload) {
        cancelActiveDownload(videoData.videoId);
        downloadProgressStore.delete(videoData.videoId);
        void crossWorldMessenger.sendMessage(CrossWorldMessage.CancelDownload, {
          videoIds: [videoData.videoId]
        });
        return;
      }

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
    const isChevronButtonClicked = !!elChevronButton?.contains(target);
    if (isChevronButtonClicked) {
      const isDownloadable = videoData.isDownloadable;
      if (!isDownloadable) {
        return;
      }

      const isNowOpen = !state.getIsPanelOpen();
      state.setIsPanelOpen(isNowOpen);

      if (isNowOpen) {
        e.stopPropagation();
        elDropdown.open();
        elChevronButton!.querySelector<HTMLButtonElement>("button")?.blur();
      } else {
        elDropdown.close();
      }
    }
  };
}
