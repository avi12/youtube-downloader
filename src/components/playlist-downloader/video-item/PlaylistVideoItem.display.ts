import { IconName, type VideoData } from "@/types";

export function resolveButtonLabel({
  videoData,
  isLocallyDone,
  isDone,
  isDownloading,
  isDownloadFailed
}: {
  videoData: VideoData | null;
  isLocallyDone: boolean;
  isDone: boolean;
  isDownloading: boolean;
  isDownloadFailed: boolean;
}) {
  const isDownloadable = videoData?.isDownloadable ?? false;
  if (!isDownloadable) {
    return "N/A";
  }

  const isComplete = isLocallyDone || isDone;
  if (isComplete) {
    return "Downloaded";
  }

  if (isDownloading) {
    return "Cancel";
  }

  if (isDownloadFailed) {
    return "Retry";
  }

  return "Download";
}

export function resolveDownloadIconName({
  isLocallyDone,
  isDone,
  isDownloading,
  isDownloadFailed
}: {
  isLocallyDone: boolean;
  isDone: boolean;
  isDownloading: boolean;
  isDownloadFailed: boolean;
}) {
  const isComplete = isLocallyDone || isDone;
  if (isComplete) {
    return IconName.CheckCircleThick;
  }

  if (isDownloading) {
    return IconName.Close;
  }

  if (isDownloadFailed) {
    return IconName.Info;
  }

  return IconName.Download;
}
