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

  function onButtonAvailable(elButton: HTMLButtonElement) {
    elButton.addEventListener("focus", () => {
      const isFocusVisible = elButton.matches(":focus-visible");
      if (!isFocusVisible) {
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
