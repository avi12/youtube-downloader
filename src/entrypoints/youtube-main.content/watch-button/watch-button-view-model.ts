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
  isError: boolean;
  isPanelOpen: boolean;
  isPanelBelow: boolean;
  downloadProgress: number;
  filename: string;
  quality: string;
  isDownloadable: boolean;
}

export function buildDownloadData(state: ButtonViewState) {
  let iconName: IconName = IconName.Download;
  if (state.isDone) {
    iconName = IconName.CheckCircleThick;
  } else if (state.isDownloading) {
    iconName = IconName.Close;
  } else if (state.isError) {
    iconName = IconName.Info;
  }

  let title = "Download";
  let accessibilityText = "Download";
  if (!state.isDownloadable) {
    title = "Not downloadable";
    accessibilityText = "Not downloadable";
  } else if (state.isDone) {
    title = "Download again";
    accessibilityText = "Download again";
  } else if (state.isDownloading) {
    title = "Cancel";
    accessibilityText = "Cancel download";
  } else if (state.isInterrupted) {
    title = "Resume";
    accessibilityText = "Resume download";
  } else if (state.isError) {
    title = "Retry";
    accessibilityText = "Retry download";
  }

  const isDisabled = !state.isDownloadable;

  let tooltip = "";
  if (state.isDownloadable) {
    const base = state.quality ? `${state.filename} - ${state.quality}` : state.filename;
    if (state.isDone) {
      tooltip = base;
    } else if (state.isError) {
      tooltip = `${base} - retry`;
    } else if (state.isInterrupted) {
      tooltip = state.downloadProgress > 0
        ? `${base} - paused at ${percentFormatter.format(state.downloadProgress)}, click to resume`
        : `${base} - click to resume`;
    } else if (state.isDownloading && state.downloadProgress === 0) {
      tooltip = `${base} - preparing, click to view progress`;
    } else if (state.isDownloading) {
      tooltip = `${base} - ${percentFormatter.format(state.downloadProgress)}, click to view progress`;
    } else {
      tooltip = base;
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

export function buildChevronData(state: ButtonViewState) {
  const isDisabled = (state.isDownloading && !state.isDone) || !state.isDownloadable;

  const panelOpenIcon = state.isPanelBelow ? IconName.ExpandMore : IconName.ExpandLess;

  return {
    iconName: state.isPanelOpen ? panelOpenIcon : IconName.ExpandMore,
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
