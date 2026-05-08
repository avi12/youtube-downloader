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
  const {
    isDone, isDownloading, isError, isInterrupted, isDownloadable,
    downloadProgress, filename, quality
  } = state;

  let iconName: IconName = IconName.Download;
  if (isDone) {
    iconName = IconName.CheckCircleThick;
  } else if (isDownloading) {
    // Close (X) is the closest native Polymer match to the design's square stop
    // glyph. The progress ring is overlaid in the icon slot; percentage label
    // stays in the text slot to the right.
    iconName = IconName.Close;
  } else if (isError) {
    iconName = IconName.Info;
  }

  let title = "Download";
  let accessibilityText = "Download";
  if (!isDownloadable) {
    title = "Not downloadable";
    accessibilityText = "Not downloadable";
  } else if (isDone) {
    title = "Download again";
    accessibilityText = "Download again";
  } else if (isDownloading) {
    title = `Stop ${percentFormatter.format(downloadProgress)}`;
    accessibilityText = `Stop download - ${percentFormatter.format(downloadProgress)} downloaded`;
  } else if (isInterrupted) {
    title = `Stop ${percentFormatter.format(downloadProgress)}`;
    accessibilityText = `Stop - paused at ${percentFormatter.format(downloadProgress)}`;
  } else if (isError) {
    title = "Retry";
    accessibilityText = "Retry download";
  }

  const isDisabled = !isDownloadable;

  let tooltip = "";
  if (isDownloadable) {
    const base = quality ? `${filename} - ${quality}` : filename;
    if (isDone) {
      tooltip = base;
    } else if (isError) {
      tooltip = `${base} - retry`;
    } else if (isInterrupted) {
      tooltip = downloadProgress > 0
        ? `${base} - stop, paused at ${percentFormatter.format(downloadProgress)}`
        : `${base} - stop`;
    } else if (isDownloading && downloadProgress === 0) {
      tooltip = `${base} - stop, preparing`;
    } else if (isDownloading) {
      tooltip = `${base} - stop, ${percentFormatter.format(downloadProgress)} downloaded`;
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
  const { isDownloadable, isPanelBelow, isPanelOpen } = state;
  const isDisabled = !isDownloadable;

  const panelOpenIcon = isPanelBelow ? IconName.ExpandMore : IconName.ExpandLess;

  return {
    iconName: isPanelOpen ? panelOpenIcon : IconName.ExpandMore,
    title: "",
    accessibilityText: isPanelOpen ? "Close download options" : "Open download options",
    style: ButtonStyle.Mono,
    type: ButtonType.Tonal,
    buttonSize: ButtonSize.Default,
    state: isDisabled ? ButtonState.Disabled : ButtonState.Active,
    isFullWidth: false,
    isDisabled,
    tooltip: state.isPanelOpen ? "Close download options" : "Download options"
  } satisfies ButtonViewModelData;
}
