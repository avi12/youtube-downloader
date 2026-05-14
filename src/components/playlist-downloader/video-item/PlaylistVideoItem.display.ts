import { IconName, type VideoData } from "@/types";

export function resolveButtonLabel(
  videoData: VideoData | null,
  isLocallyDone: boolean,
  isDone: boolean,
  isDownloading: boolean,
  isDownloadFailed: boolean
) {
  if (!videoData?.isDownloadable) {
    return "N/A";
  }

  if (isLocallyDone || isDone) {
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

export function resolveDownloadIconName(
  isLocallyDone: boolean,
  isDone: boolean,
  isDownloading: boolean,
  isDownloadFailed: boolean
) {
  if (isLocallyDone || isDone) {
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
