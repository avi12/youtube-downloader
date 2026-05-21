import { DATA_BUTTON_ID_ATTR, sendButtonData } from "@/lib/ui/polymer-utils";
import {
  ButtonSize,
  ButtonState,
  ButtonStyle,
  ButtonType,
  IconName,
  type VideoData
} from "@/types";

type AssignButtonIdParams = {
  elButton: Element;
  buttonId: string;
};
function assignButtonId({ elButton, buttonId }: AssignButtonIdParams) {
  const isIdMismatch = elButton.getAttribute(DATA_BUTTON_ID_ATTR) !== buttonId;
  if (isIdMismatch) {
    elButton.setAttribute(DATA_BUTTON_ID_ATTR, buttonId);
  }
}

type SendDownloadButtonDataParams = {
  elButton: Element;
  buttonId: string;
  tooltip: string;
  videoData: VideoData | null;
  downloadIconName: IconName;
  isDisabled: boolean;
};
export function sendDownloadButtonData({
  elButton,
  buttonId,
  tooltip,
  videoData,
  downloadIconName,
  isDisabled
}: SendDownloadButtonDataParams) {
  assignButtonId({
    elButton,
    buttonId
  });
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

type SendChevronButtonDataParams = {
  elButton: Element;
  buttonId: string;
  iconName: IconName;
  isDisabled: boolean;
};
export function sendChevronButtonData({
  elButton,
  buttonId,
  iconName,
  isDisabled
}: SendChevronButtonDataParams) {
  assignButtonId({
    elButton,
    buttonId
  });
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
