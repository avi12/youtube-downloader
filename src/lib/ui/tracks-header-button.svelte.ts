import { sendButtonData } from "./polymer-utils";
import {
  ButtonSize,
  ButtonState,
  ButtonStyle,
  ButtonType,
  IconName
} from "@/types";

export function attachTracksHeaderButton({
  elButton,
  getIsOpen,
  getIsDownloading,
  getIsAudioOnly,
  getSummaryMeta
}: {
  elButton: Element;
  getIsOpen: () => boolean;
  getIsDownloading: () => boolean;
  getIsAudioOnly: () => boolean;
  getSummaryMeta: () => string;
}) {
  $effect(() => {
    const isOpen = getIsOpen();
    const isDownloading = getIsDownloading();
    const isAudioOnly = getIsAudioOnly();
    const summaryMeta = getSummaryMeta();
    const sectionTitle = isAudioOnly ? "Audio language" : "Tracks";
    const fullTitle = summaryMeta ? `${sectionTitle}  ·  ${summaryMeta}` : sectionTitle;
    sendButtonData({
      elButton,
      data: {
        iconName: isOpen ? IconName.ExpandLess : IconName.ExpandMore,
        title: isOpen ? sectionTitle : fullTitle,
        accessibilityText: isOpen ? sectionTitle : fullTitle,
        style: ButtonStyle.Mono,
        type: ButtonType.Outline,
        buttonSize: ButtonSize.Default,
        state: isDownloading ? ButtonState.Disabled : ButtonState.Active,
        isFullWidth: true,
        isDisabled: isDownloading,
        tooltip: ""
      }
    });
  });
}
