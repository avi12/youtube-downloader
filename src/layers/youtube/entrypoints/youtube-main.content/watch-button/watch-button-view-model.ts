import { buildDownloadTitle, buildDownloadTooltip, type ButtonViewState } from "./watch-button-format";
import { WatchButtonLayout } from "./watch-button-types";
import {
  ButtonIconPosition,
  ButtonSize,
  ButtonState,
  ButtonStyle,
  ButtonType,
  type ButtonViewModelData,
  IconName
} from "@/types";

export type { ButtonViewState } from "./watch-button-format";

const SHORTS_DOWNLOAD_SHAPE = {
  buttonSize: ButtonSize.Large,
  iconPosition: ButtonIconPosition.Above
} as const;

const SHORTS_CHEVRON_SHAPE = {
  buttonSize: ButtonSize.Small
} as const;

export function buildDownloadData(state: ButtonViewState, layout: WatchButtonLayout) {
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
    tooltip,
    ...layout === WatchButtonLayout.Shorts && SHORTS_DOWNLOAD_SHAPE
  };
  return data;
}

export function buildChevronData(state: ButtonViewState, layout: WatchButtonLayout) {
  const { isDownloadable, isPanelBelow, isPanelOpen } = state;
  const isDisabled = !isDownloadable;
  const isPanelOpenAbove = isPanelOpen && !isPanelBelow;

  return {
    iconName: isPanelOpenAbove ? IconName.ExpandLess : IconName.ExpandMore,
    title: "",
    accessibilityText: isPanelOpen ? "Close download options" : "Open download options",
    style: ButtonStyle.Mono,
    type: ButtonType.Tonal,
    buttonSize: ButtonSize.Default,
    state: isDisabled ? ButtonState.Disabled : ButtonState.Active,
    isFullWidth: false,
    isDisabled,
    tooltip: isPanelOpen ? "Close download options" : "Download options",
    ...layout === WatchButtonLayout.Shorts && SHORTS_CHEVRON_SHAPE
  } satisfies ButtonViewModelData;
}
