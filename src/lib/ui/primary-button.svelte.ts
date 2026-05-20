import { sendButtonData } from "@/lib/ui/polymer-utils";
import {
  ButtonSize,
  ButtonState,
  ButtonStyle,
  ButtonType,
  IconName,
  type ButtonViewModelData
} from "@/types";

export enum PrimaryButtonState {
  Idle = "idle",
  Downloading = "downloading",
  Interrupted = "interrupted",
  Done = "done",
  Failed = "failed"
}

interface AttachPrimaryButtonParams {
  elButton: Element;
  getState: () => PrimaryButtonState;
  getIsDownloadable: () => boolean;
  getIsFilenameValid: () => boolean;
  getEstimatedSizeLabel: () => string;
}

export function attachPrimaryButton(
  { elButton, getState, getIsDownloadable, getIsFilenameValid, getEstimatedSizeLabel }: AttachPrimaryButtonParams
) {
  $effect(() => {
    const state = getState();
    const isNotIdle = state !== PrimaryButtonState.Idle;
    const isDownloadReady = getIsDownloadable() && getIsFilenameValid();
    const isActive = isNotIdle || isDownloadReady;
    const isHtmlElement = elButton instanceof HTMLElement;
    if (isHtmlElement) {
      elButton.classList.toggle("ytdl-cancel-state", state === PrimaryButtonState.Downloading);
    }

    const data: ButtonViewModelData = (() => {
      const isDownloading = state === PrimaryButtonState.Downloading;
      if (isDownloading) {
        return {
          iconName: "",
          title: "Cancel",
          accessibilityText: "Cancel",
          style: ButtonStyle.Mono,
          type: ButtonType.Outline,
          buttonSize: ButtonSize.Default,
          state: ButtonState.Active,
          isFullWidth: true,
          isDisabled: false,
          tooltip: ""
        };
      }

      const isInterrupted = state === PrimaryButtonState.Interrupted;
      if (isInterrupted) {
        return {
          iconName: IconName.Download,
          title: "Resume now",
          accessibilityText: "Resume now",
          style: ButtonStyle.CallToAction,
          type: ButtonType.Tonal,
          buttonSize: ButtonSize.Default,
          state: ButtonState.Active,
          isFullWidth: true,
          isDisabled: false,
          tooltip: ""
        };
      }

      const isFailed = state === PrimaryButtonState.Failed;
      if (isFailed) {
        return {
          iconName: IconName.Download,
          title: "Retry download",
          accessibilityText: "Retry download",
          style: ButtonStyle.Mono,
          type: ButtonType.Filled,
          buttonSize: ButtonSize.Default,
          state: ButtonState.Active,
          isFullWidth: true,
          isDisabled: false,
          tooltip: ""
        };
      }

      const sizeLabel = getEstimatedSizeLabel();
      const baseTitle = state === PrimaryButtonState.Done ? "Download again" : "Download";
      const title = sizeLabel ? `${baseTitle}  ·  ${sizeLabel}` : baseTitle;
      return {
        iconName: IconName.Download,
        title,
        accessibilityText: title,
        style: ButtonStyle.Mono,
        type: ButtonType.Filled,
        buttonSize: ButtonSize.Default,
        state: isActive ? ButtonState.Active : ButtonState.Disabled,
        isFullWidth: true,
        isDisabled: !isActive,
        tooltip: ""
      };
    })();

    sendButtonData({
      elButton,
      data
    });
  });
}
