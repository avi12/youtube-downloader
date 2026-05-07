import type { ButtonState } from "./button-state";
import {
  createButtonGroup,
  createDropdownElement,
  findNativeDownloadButton,
  injectWatchButtonStyles
} from "./watch-button-dom";
import { buildInitialDownloadState } from "./watch-button-state";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";
import type { VideoData } from "@/types";

export function buildButtonState(videoData: VideoData): ButtonState {
  const initialState = buildInitialDownloadState(videoData);
  return {
    isDownloading: false,
    isDone: false,
    isInterrupted: initialState.isInterrupted,
    isError: false,
    isPanelOpen: false,
    downloadProgress: 0,
    downloadProgressType: "",
    defaultVideoItag: initialState.videoItag,
    defaultAudioItag: initialState.audioItag,
    defaultFilename: initialState.filename,
    defaultQuality: initialState.quality,
    defaultDownloadType: initialState.downloadType,
    lastProgressReported: -1,
    lastRenderedButtonKey: "",
    lastRenderedChevronKey: ""
  };
}

export function buildButtonElements({
  videoId, elActionsContainer, isShowNativeDownload
}: {
  videoId: string;
  elActionsContainer: HTMLElement;
  isShowNativeDownload: boolean;
}) {
  const nativeButtons = elActionsContainer.querySelectorAll("yt-button-view-model");
  const scopingClass = nativeButtons[nativeButtons.length - 1]?.getAttribute("class") ?? "";

  injectWatchButtonStyles();

  const elNativeDownload = findNativeDownloadButton(elActionsContainer);
  if (!isShowNativeDownload && elNativeDownload) {
    elNativeDownload.classList.add("ytdl-native-hidden");
  }

  const buttonGroup = createButtonGroup({
    elActionsContainer,
    elNativeDownload,
    scopingClass
  });
  const dropdownElements = createDropdownElement({
    videoId,
    elGroup: buttonGroup.elGroup
  });
  const elements = {
    ...buttonGroup,
    ...dropdownElements
  };
  return {
    elements,
    elNativeDownload
  };
}

export function notifyPanelContentReady(videoData: VideoData, panelContentId: string) {
  void crossWorldMessenger.sendMessage(CrossWorldMessage.PanelContentReady, {
    contentId: panelContentId,
    videoData
  });
}
