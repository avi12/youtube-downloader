import { performDownload } from "../video/download";
import { refreshButtons } from "./button-handlers";
import type { ButtonElements } from "./button-handlers";
import type { ButtonState } from "./button-state";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";
import type { VideoData } from "@/types";

export function handleClickEvent(
  e: Event,
  state: ButtonState,
  videoData: VideoData,
  elements: ButtonElements,
  applySegmentedClasses: () => void,
  cancelActiveDownload: (videoId: string) => void
) {
  const { target } = e;
  if (!(target instanceof Node)) {
    return;
  }

  const { elGroup, elChevronButton, elDropdown } = elements;
  if (elGroup.children[0]?.contains(target)) {
    if (!videoData.isDownloadable) {
      return;
    }

    if (state.isDownloading) {
      state.isDownloading = false;
      refreshButtons(state, videoData, elements, applySegmentedClasses);
      cancelActiveDownload(videoData.videoId);
      void crossWorldMessenger.sendMessage(CrossWorldMessage.CancelRequest, { videoIds: [videoData.videoId] });
      return;
    }

    state.isDone = false;
    state.isInterrupted = false;
    state.isError = false;
    state.isDownloading = true;
    state.downloadProgress = 0;
    refreshButtons(state, videoData, elements, applySegmentedClasses);
    void performDownload({
      type: state.defaultDownloadType,
      videoId: videoData.videoId,
      videoItag: state.defaultVideoItag,
      audioItag: state.defaultAudioItag,
      filenameOutput: state.defaultFilename
    });
    return;
  }

  if (elGroup.children[1]?.contains(target)) {
    if (!videoData.isDownloadable) {
      return;
    }

    state.isPanelOpen = !state.isPanelOpen;
    refreshButtons(state, videoData, elements, applySegmentedClasses);

    if (state.isPanelOpen) {
      e.stopPropagation();
      elDropdown.open();
      elChevronButton.querySelector<HTMLButtonElement>("button")?.blur();
    } else {
      elDropdown.close();
    }
  }
}
