import { DATA_BUTTON_ID_ATTR, sendButtonData } from "@/lib/ui/polymer-utils";
import {
  ButtonSize,
  ButtonState,
  ButtonStyle,
  ButtonType,
  IconName,
  type VideoData
} from "@/types";

function assignButtonId(elButton: Element, buttonId: string) {
  if (elButton.getAttribute(DATA_BUTTON_ID_ATTR) !== buttonId) {
    elButton.setAttribute(DATA_BUTTON_ID_ATTR, buttonId);
  }
}

export function sendDownloadButtonData(
  elButton: Element,
  buttonId: string,
  tooltip: string,
  videoData: VideoData | null,
  downloadIconName: IconName,
  isDisabled: boolean
) {
  assignButtonId(elButton, buttonId);
  sendButtonData({
    elButton,
    data: {
      iconName: downloadIconName,
      title: "",
      accessibilityText: videoData ? `${tooltip} ${videoData.title}` : tooltip,
      style: ButtonStyle.Mono,
      type: ButtonType.Tonal,
      buttonSize: ButtonSize.Default,
      state: isDisabled ? ButtonState.Disabled : ButtonState.Active,
      isFullWidth: false,
      isDisabled,
      tooltip
    }
  });
}

export function sendChevronButtonData(
  elButton: Element,
  buttonId: string,
  iconName: IconName,
  isDisabled: boolean
) {
  assignButtonId(elButton, buttonId);
  sendButtonData({
    elButton,
    data: {
      iconName,
      title: "",
      accessibilityText: "Download options",
      style: ButtonStyle.Mono,
      type: ButtonType.Tonal,
      buttonSize: ButtonSize.Default,
      state: isDisabled ? ButtonState.Disabled : ButtonState.Active,
      isFullWidth: false,
      isDisabled,
      tooltip: "Options"
    }
  });
}
