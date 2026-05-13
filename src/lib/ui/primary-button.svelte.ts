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

export function attachPrimaryButton({ elButton, getState, getIsDownloadable, getIsFilenameValid }: {
  elButton: Element;
  getState: () => PrimaryButtonState;
  getIsDownloadable: () => boolean;
  getIsFilenameValid: () => boolean;
}) {
  $effect(() => {
    const state = getState();
    const isActive = state !== PrimaryButtonState.Idle || (getIsDownloadable() && getIsFilenameValid());
    if (elButton instanceof HTMLElement) {
      elButton.classList.toggle("ytdl-cancel-state", state === PrimaryButtonState.Downloading);
    }

    const data: ButtonViewModelData = (() => {
      if (state === PrimaryButtonState.Downloading) {
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

      if (state === PrimaryButtonState.Interrupted) {
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

      if (state === PrimaryButtonState.Failed) {
        return {
          iconName: IconName.Download,
          title: "Retry download",
          accessibilityText: "Retry download",
          style: ButtonStyle.CallToAction,
          type: ButtonType.Filled,
          buttonSize: ButtonSize.Default,
          state: ButtonState.Active,
          isFullWidth: true,
          isDisabled: false,
          tooltip: ""
        };
      }

      const title = state === PrimaryButtonState.Done ? "Download again" : "Download";
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
