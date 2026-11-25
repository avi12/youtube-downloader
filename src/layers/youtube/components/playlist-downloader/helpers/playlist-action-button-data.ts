import {
  ButtonSize,
  ButtonState,
  ButtonStyle,
  ButtonType,
  IconName
} from "@/types";

export const ACTION_BUTTON_IDS = {
  DeselectAll: "playlist-deselect-all-btn",
  Download: "playlist-download-btn",
  DownloadAll: "playlist-download-all-btn"
} as const;

export function buildDeselectAllData(isDisabled: boolean) {
  return {
    iconName: IconName.None,
    title: "Clear",
    accessibilityText: "Clear selection",
    style: ButtonStyle.CallToAction,
    type: ButtonType.Text,
    buttonSize: ButtonSize.XSmall,
    state: isDisabled ? ButtonState.Disabled : ButtonState.Active,
    isFullWidth: false,
    isDisabled,
    tooltip: "Clear selection"
  };
}

const STOP_ALL_LABEL = "Stop all";

export function buildDownloadData({
  isDisabled,
  isStopButton,
  downloadButtonLabel
}: {
  isDisabled: boolean;
  isStopButton: boolean;
  downloadButtonLabel: string;
}) {
  const label = isStopButton ? STOP_ALL_LABEL : downloadButtonLabel;
  return {
    iconName: isStopButton ? IconName.Close : IconName.Download,
    title: label,
    accessibilityText: label,
    style: ButtonStyle.Mono,
    type: ButtonType.Tonal,
    buttonSize: ButtonSize.Default,
    state: isDisabled ? ButtonState.Disabled : ButtonState.Active,
    isFullWidth: false,
    isDisabled,
    tooltip: label
  };
}

export function buildDownloadAllData({
  isBusy,
  isRevealingAll,
  isStopButton,
  revealedVideoCount
}: {
  isBusy: boolean;
  isRevealingAll: boolean;
  isStopButton: boolean;
  revealedVideoCount: number;
}) {
  let label = "Download whole playlist";
  let tooltip = "Reveal all videos and download";
  if (isRevealingAll) {
    label = `Revealing hidden videos (${revealedVideoCount})`;
    tooltip = "Stop revealing";
  } else if (isStopButton) {
    label = STOP_ALL_LABEL;
    tooltip = "Stop all downloads";
  }

  const isCancel = isRevealingAll || isStopButton;
  const isDisabled = isBusy && !isCancel;
  return {
    iconName: isCancel ? IconName.Close : IconName.Download,
    title: label,
    accessibilityText: label,
    style: ButtonStyle.Mono,
    type: ButtonType.Outline,
    buttonSize: ButtonSize.Default,
    state: isDisabled ? ButtonState.Disabled : ButtonState.Active,
    isFullWidth: false,
    isDisabled,
    tooltip
  };
}
