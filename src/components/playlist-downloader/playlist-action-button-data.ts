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
  DownloadAll: "playlist-download-all-btn",
  StopAll: "playlist-stop-all-btn"
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

export function buildDownloadData(isDisabled: boolean, isDownloading: boolean, downloadButtonLabel: string) {
  return {
    iconName: isDownloading ? IconName.Close : IconName.Download,
    title: downloadButtonLabel,
    accessibilityText: downloadButtonLabel,
    style: ButtonStyle.Mono,
    type: ButtonType.Tonal,
    buttonSize: ButtonSize.Default,
    state: isDisabled ? ButtonState.Disabled : ButtonState.Active,
    isFullWidth: false,
    isDisabled,
    tooltip: downloadButtonLabel
  };
}

export function buildDownloadAllData(isBusy: boolean, isRevealingAll: boolean, revealedVideoCount: number) {
  const label = isRevealingAll
    ? `Revealing hidden videos (${revealedVideoCount})`
    : "Download whole playlist";
  const tooltip = isRevealingAll ? "Stop revealing" : "Reveal all videos and download";
  return {
    iconName: isRevealingAll ? IconName.Close : IconName.Download,
    title: label,
    accessibilityText: label,
    style: ButtonStyle.Mono,
    type: ButtonType.Outline,
    buttonSize: ButtonSize.Default,
    state: isBusy && !isRevealingAll ? ButtonState.Disabled : ButtonState.Active,
    isFullWidth: false,
    isDisabled: isBusy && !isRevealingAll,
    tooltip
  };
}

export function buildStopAllData() {
  return {
    iconName: IconName.Stop,
    title: "Stop all",
    accessibilityText: "Stop all downloads",
    style: ButtonStyle.Mono,
    type: ButtonType.Text,
    buttonSize: ButtonSize.Default,
    state: ButtonState.Active,
    isFullWidth: false,
    isDisabled: false,
    tooltip: "Stop all downloads"
  };
}
