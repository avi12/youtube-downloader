import { sendButtonData } from "@/lib/ui/polymer-utils";
import { CHILD_LIST_SUBTREE } from "@/lib/utils/dom";
import {
  ButtonSize,
  ButtonState,
  ButtonStyle,
  ButtonType,
  IconName,
  type ButtonViewModelData
} from "@/types";

export function attachCloseButton(elTarget: Element) {
  const closeData: ButtonViewModelData = {
    iconName: IconName.Close,
    title: "",
    accessibilityText: "Close",
    style: ButtonStyle.Mono,
    type: ButtonType.Tonal,
    buttonSize: ButtonSize.Default,
    state: ButtonState.Active,
    isFullWidth: false,
    isDisabled: false,
    tooltip: ""
  };

  sendButtonData({
    elButton: elTarget,
    data: closeData
  });

  // Polymer's tp-yt-paper-tooltip shows on both hover and focus;
  // set tooltip text only when :focus-visible matches so hover stays silent.
  function onButtonAvailable(elButton: HTMLButtonElement) {
    elButton.addEventListener("focus", () => {
      if (!elButton.matches(":focus-visible")) {
        return;
      }

      sendButtonData({
        elButton: elTarget,
        data: {
          ...closeData,
          tooltip: "Close"
        }
      });
    });

    elButton.addEventListener("blur", () => {
      sendButtonData({
        elButton: elTarget,
        data: closeData
      });
    });
  }

  const elButton = elTarget.querySelector("button");
  if (elButton) {
    onButtonAvailable(elButton);
    return;
  }

  const observer = new MutationObserver(() => {
    const elInner = elTarget.querySelector("button");
    if (!elInner) {
      return;
    }

    observer.disconnect();
    onButtonAvailable(elInner);
  });

  observer.observe(elTarget, CHILD_LIST_SUBTREE);
}

export function attachDownloadButton({ elButton, getIsDownloadable, getIsFilenameValid, getIsDone }: {
  elButton: Element;
  getIsDownloadable: () => boolean;
  getIsFilenameValid: () => boolean;
  getIsDone: () => boolean;
}) {
  $effect(() => {
    const isActive = getIsDownloadable() && getIsFilenameValid();
    const isDone = getIsDone();
    const title = isDone ? "Download again" : "Download";
    sendButtonData({
      elButton,
      data: {
        iconName: IconName.Download,
        title,
        accessibilityText: title,
        style: ButtonStyle.CallToAction,
        type: ButtonType.Tonal,
        buttonSize: ButtonSize.Default,
        state: isActive ? ButtonState.Active : ButtonState.Disabled,
        isFullWidth: true,
        isDisabled: !isActive,
        tooltip: ""
      }
    });
  });
}

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

export function attachViewButton(elButton: Element) {
  sendButtonData({
    elButton,
    data: {
      iconName: IconName.Visibility,
      title: "View",
      accessibilityText: "View in folder",
      style: ButtonStyle.CallToAction,
      type: ButtonType.Text,
      buttonSize: ButtonSize.XSmall,
      state: ButtonState.Active,
      isFullWidth: false,
      isDisabled: false,
      tooltip: "View in folder"
    }
  });
}
