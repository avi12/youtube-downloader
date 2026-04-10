import { sendButtonData } from "@/lib/polymer-utils";
import {
  ButtonSize,
  ButtonState,
  ButtonStyle,
  ButtonType,
  IconName,
  isPolymerProgressElement,
  type ButtonViewModelData
} from "@/types";

function dispatchButtonData(elButton: Element, data: ButtonViewModelData) {
  sendButtonData(elButton, data);
}

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

  dispatchButtonData(elTarget, closeData);

  // Show the "Close" tooltip only on keyboard focus (Tab), not on mouse hover.
  // Polymer's tp-yt-paper-tooltip shows on both hover and focus by default,
  // so we dynamically set the tooltip text only when :focus-visible matches.
  // Polymer renders the inner <button> asynchronously, so we observe until
  // it appears rather than relying on requestAnimationFrame timing.
  function onButtonAvailable(elButton: HTMLButtonElement) {
    elButton.addEventListener("focus", () => {
      if (!elButton.matches(":focus-visible")) {
        return;
      }

      dispatchButtonData(elTarget, { ...closeData, tooltip: "Close" });
    });

    elButton.addEventListener("blur", () => {
      dispatchButtonData(elTarget, closeData);
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

  observer.observe(elTarget, { childList: true, subtree: true });
}

export function attachDoneIcon(elButton: Element) {
  dispatchButtonData(elButton, {
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
  });
}

export function attachCancelButton(elButton: Element) {
  dispatchButtonData(elButton, {
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
  });
}

export function attachDownloadButton(
  elButton: Element,
  getIsDownloadable: () => boolean,
  getIsFilenameValid: () => boolean,
  getIsDone: () => boolean
) {
  $effect(() => {
    const isActive = getIsDownloadable() && getIsFilenameValid();
    const isDone = getIsDone();
    const title = isDone ? "Download again" : "Download";
    dispatchButtonData(elButton, {
      iconName: IconName.Download,
      title,
      accessibilityText: title,
      style: ButtonStyle.CallToAction,
      type: ButtonType.Filled,
      buttonSize: ButtonSize.Default,
      state: isActive ? ButtonState.Active : ButtonState.Disabled,
      isFullWidth: true,
      isDisabled: !isActive,
      tooltip: ""
    });
  });
}

export function attachPanelProgress(elProgress: Element) {
  if (!isPolymerProgressElement(elProgress)) {
    return;
  }

  elProgress.updateStyles({
    "--paper-progress-active-color": "var(--yt-spec-call-to-action, rgb(62 166 255))",
    "--paper-progress-container-color": "transparent"
  });
}
