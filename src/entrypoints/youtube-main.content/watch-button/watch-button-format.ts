import { percentFormatter, type ButtonViewState } from "./watch-button-types";
import { ProgressType } from "@/types";

export type { ButtonViewState } from "./watch-button-types";

export function buildDownloadTitle(state: ButtonViewState) {
  const { isDone, isDownloading, isError, isInterrupted, isDownloadable, downloadProgress, progressType } = state;
  const isProcessing = isDownloading && progressType === ProgressType.FFmpeg;
  if (!isDownloadable) {
    return {
      title: "Not downloadable",
      accessibilityText: "Not downloadable"
    };
  }

  if (isDone) {
    return {
      title: "Download again",
      accessibilityText: "Download again"
    };
  }

  if (isProcessing) {
    const pct = percentFormatter.format(downloadProgress);
    return {
      title: pct,
      accessibilityText: `${pct} processed - click to cancel`
    };
  }

  if (isDownloading) {
    const pct = percentFormatter.format(downloadProgress);
    return {
      title: pct,
      accessibilityText: `Stop download - ${pct} downloaded`
    };
  }

  if (isInterrupted) {
    const pct = percentFormatter.format(downloadProgress);
    return {
      title: pct,
      accessibilityText: `Stop - paused at ${pct}`
    };
  }

  if (isError) {
    return {
      title: "Retry",
      accessibilityText: "Retry download"
    };
  }

  return {
    title: "Download",
    accessibilityText: "Download"
  };
}

export function buildDownloadTooltip(state: ButtonViewState) {
  const {
    isDone, isDownloading, isError, isInterrupted, isDownloadable,
    downloadProgress, progressType, filename, quality
  } = state;
  if (!isDownloadable) {
    return "";
  }

  const isProcessing = isDownloading && progressType === ProgressType.FFmpeg;
  const isPreparingDownload = isDownloading && downloadProgress === 0;
  const isActivelyDownloading = isDownloading && downloadProgress > 0;
  const base = quality ? `${filename} - ${quality}` : filename;
  if (isDone) {
    return base;
  }

  if (isError) {
    return `${base} - retry`;
  }

  if (isInterrupted) {
    return downloadProgress > 0
      ? `${base} - paused at ${percentFormatter.format(downloadProgress)}`
      : base;
  }

  if (isProcessing) {
    return `${base} - ${percentFormatter.format(downloadProgress)} (processing), click to cancel`;
  }

  if (isPreparingDownload) {
    return `${base} - preparing`;
  }

  if (isActivelyDownloading) {
    return `${base} - ${percentFormatter.format(downloadProgress)} downloaded`;
  }

  return base;
}
