import { sendButtonData } from "@/lib/ui/polymer-utils";
import { CHILD_LIST_SUBTREE } from "@/lib/utils/dom";
import {
  ButtonSize,
  ButtonState,
  ButtonStyle,
  ButtonType,
  IconName,
  isPolymerProgressElement,
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

export function attachDoneIcon(elButton: Element) {
  sendButtonData({
    elButton,
    data: {
      iconName: IconName.CheckCircleThick,
      title: "",
      accessibilityText: "",
      style: ButtonStyle.CallToAction,
      type: ButtonType.Text,
      buttonSize: ButtonSize.Small,
      state: ButtonState.Disabled,
      isFullWidth: false,
      isDisabled: true,
      tooltip: ""
    }
  });
}

export function attachCancelButton(elButton: Element) {
  sendButtonData({
    elButton,
    data: {
      iconName: "",
      title: "Cancel",
      accessibilityText: "Cancel",
      style: ButtonStyle.Mono,
      type: ButtonType.Tonal,
      buttonSize: ButtonSize.Small,
      state: ButtonState.Active,
      isFullWidth: false,
      isDisabled: false,
      tooltip: ""
    }
  });
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

const ACCENT_DARK = "#3ea6ff";
const SUCCESS_DARK = "#6cd16c";

function applyProgressStyles(elProgress: Element, activeColor: string) {
  requestAnimationFrame(() => {
    if (!isPolymerProgressElement(elProgress)) {
      return;
    }

    elProgress.updateStyles({
      "--paper-progress-active-color": activeColor,
      "--paper-progress-container-color": "var(--ytdl-progress-track)",
      "--paper-progress-height": "4px"
    });
  });
}

export function attachPanelProgress(elProgress: Element) {
  applyProgressStyles(elProgress, `var(--yt-spec-call-to-action, ${ACCENT_DARK})`);
}

export function attachPanelProgressDone(elProgress: Element) {
  applyProgressStyles(elProgress, `var(--yt-spec-text-success, ${SUCCESS_DARK})`);
}

const ERROR_DARK = "#ff6b6b";

export function attachPanelProgressFailed(elProgress: Element) {
  applyProgressStyles(elProgress, `var(--yt-spec-text-error, ${ERROR_DARK})`);
}

export function attachGhostButton(title: string) {
  return (elButton: Element) => {
    sendButtonData({
      elButton,
      data: {
        iconName: "",
        title,
        accessibilityText: title,
        style: ButtonStyle.Mono,
        type: ButtonType.Text,
        buttonSize: ButtonSize.Default,
        state: ButtonState.Active,
        isFullWidth: false,
        isDisabled: false,
        tooltip: ""
      }
    });
  };
}

export function attachResumeButton(elButton: Element) {
  sendButtonData({
    elButton,
    data: {
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
    }
  });
}
