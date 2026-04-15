import {
  ButtonSize,
  ButtonState,
  ButtonStyle,
  ButtonType,
  type ButtonViewModelData,
  IconName
} from "@/types";

const percentFormatter = new Intl.NumberFormat(document.documentElement.lang, {
  style: "percent",
  maximumFractionDigits: 0
});

export interface ButtonViewState {
  isDownloading: boolean;
  isDone: boolean;
  isInterrupted: boolean;
  isPanelOpen: boolean;
  downloadProgress: number;
  filename: string;
  quality: string;
  isDownloadable: boolean;
}

export function buildDownloadData(state: ButtonViewState): ButtonViewModelData {
  let iconName: IconName = IconName.Download;
  if (state.isDone) {
    iconName = IconName.CheckCircleThick;
  } else if (state.isDownloading) {
    iconName = IconName.Close;
  }

  let title = "Download";
  let accessibilityText = "Download";
  if (!state.isDownloadable) {
    title = "Not downloadable";
    accessibilityText = "Not downloadable";
  } else if (state.isDone) {
    title = "Downloaded";
    accessibilityText = "Download again";
  } else if (state.isDownloading) {
    title = "Cancel";
    accessibilityText = "Cancel download";
  } else if (state.isInterrupted) {
    title = "Resume";
    accessibilityText = "Resume download";
  }

  const isDisabled = !state.isDownloadable;

  let tooltip = "";
  if (state.isDownloadable) {
    if (state.isDownloading && state.downloadProgress === 0) {
      tooltip = "Preparing";
    } else if (state.isDownloading) {
      tooltip = percentFormatter.format(state.downloadProgress);
    } else {
      tooltip = state.quality ? `${state.filename} - ${state.quality}` : state.filename;
    }
  }

  return {
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
  } satisfies ButtonViewModelData;
}

export function buildChevronData(state: ButtonViewState): ButtonViewModelData {
  const isDisabled = (state.isDownloading && !state.isDone) || !state.isDownloadable;

  return {
    iconName: state.isPanelOpen ? IconName.ExpandLess : IconName.ExpandMore,
    title: "",
    accessibilityText: state.isPanelOpen ? "Close download options" : "Open download options",
    style: ButtonStyle.Mono,
    type: ButtonType.Tonal,
    buttonSize: ButtonSize.Default,
    state: isDisabled ? ButtonState.Disabled : ButtonState.Active,
    isFullWidth: false,
    isDisabled,
    tooltip: state.isPanelOpen ? "Close download options" : "Download options"
  } satisfies ButtonViewModelData;
}
