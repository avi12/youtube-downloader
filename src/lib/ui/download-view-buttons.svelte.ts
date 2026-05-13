import { sendButtonData } from "@/lib/ui/polymer-utils";
import {
  ButtonSize,
  ButtonState,
  ButtonStyle,
  ButtonType,
  IconName
} from "@/types";

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
