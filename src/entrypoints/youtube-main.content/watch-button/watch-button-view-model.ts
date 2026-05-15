import { buildDownloadTitle, buildDownloadTooltip, type ButtonViewState } from "./watch-button-format";
import {
  ButtonSize,
  ButtonState,
  ButtonStyle,
  ButtonType,
  type ButtonViewModelData,
  IconName
} from "@/types";

export type { ButtonViewState } from "./watch-button-format";

export function buildDownloadData(state: ButtonViewState) {
  const { isDone, isDownloading, isError, isDownloadable } = state;

  let iconName: IconName = IconName.Download;
  if (isDone) {
    iconName = IconName.CheckCircleThick;
  } else if (isDownloading) {
    iconName = IconName.Close;
  } else if (isError) {
    iconName = IconName.Info;
  }

  const { title, accessibilityText } = buildDownloadTitle(state);
  const isDisabled = !isDownloadable;
  const tooltip = buildDownloadTooltip(state);

  const data: ButtonViewModelData = {
    iconName,
    title,
    accessibilityText,
    style: ButtonStyle.Mono,
    type: ButtonType.Tonal,
    buttonSize: ButtonSize.Default,
    state: isDisabled ? ButtonState.Disabled : ButtonState.Active,
    isFullWidth: false,
    isDisabled,
    tooltip
  };
  return data;
}

export function buildChevronData(state: ButtonViewState) {
  const { isDownloadable, isPanelBelow, isPanelOpen } = state;
  const isDisabled = !isDownloadable;

  return {
    iconName: isPanelOpen && !isPanelBelow ? IconName.ExpandLess : IconName.ExpandMore,
    title: "",
    accessibilityText: isPanelOpen ? "Close download options" : "Open download options",
    style: ButtonStyle.Mono,
    type: ButtonType.Tonal,
    buttonSize: ButtonSize.Default,
    state: isDisabled ? ButtonState.Disabled : ButtonState.Active,
    isFullWidth: false,
    isDisabled,
    tooltip: isPanelOpen ? "Close download options" : "Download options"
  } satisfies ButtonViewModelData;
}
