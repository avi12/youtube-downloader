import { calculateWeightedProgress } from "@/lib/youtube/video-helpers";
import { ProgressType } from "@/types";

export interface ProgressUpdateHandlers {
  setIsDownloading(value: boolean): void;
  setIsDone(value: boolean): void;
  setIsError(value: boolean): void;
  setIsInterrupted(value: boolean): void;
  setDownloadProgress(value: number): void;
  setDownloadProgressType(value: ProgressType | ""): void;
  setLastProgressReported(value: string): void;
  getIsDone(): boolean;
  getLastProgressReported(): string;
}

export function handleProgressUpdate({ data, videoId, handlers }: {
  data: {
    videoId: string;
    isRemoved?: boolean;
    isFailed?: boolean;
    isSaved?: boolean;
    progress: number;
    progressType: ProgressType | "";
  };
  videoId: string;
  handlers: ProgressUpdateHandlers;
}) {
  const isForOtherVideo = data.videoId !== videoId;
  if (isForOtherVideo) {
    return;
  }

  if (handlers.getIsDone()) {
    if (!data.isRemoved) {
      return;
    }

    handlers.setIsDone(false);
    handlers.setLastProgressReported("");
  }

  // `isSaved` is the terminal event after the file is on disk. It shares
  // (progress=1, progressType=FFmpeg) with the muxing-complete update that
  // arrives ~1s earlier, so include it in the dedup key to keep both through.
  const reportedKey = data.isRemoved
    ? ""
    : `${data.progress}|${data.progressType}|${data.isSaved ? "saved" : ""}`;
  const isDuplicateProgress = !data.isRemoved && reportedKey === handlers.getLastProgressReported();
  if (isDuplicateProgress) {
    return;
  }

  handlers.setLastProgressReported(data.isRemoved ? "" : reportedKey);

  if (data.isRemoved) {
    handlers.setIsDownloading(false);
    handlers.setDownloadProgress(0);
    handlers.setDownloadProgressType("");

    if (data.isFailed) {
      handlers.setIsError(true);
    }

    return;
  }

  handlers.setIsError(false);
  handlers.setIsInterrupted(false);
  handlers.setDownloadProgress(
    calculateWeightedProgress({
      isDownloading: true,
      progress: data.progress,
      progressType: data.progressType
    }) / 100
  );
  handlers.setDownloadProgressType(data.progressType);

  // `isSaved` is dispatched after `browser.downloads.download` resolves AND
  // `chrome.downloads` reports state=complete. FFmpeg phase finishing at
  // progress=1 used to flip us to done, but that fires ~1s before the file is
  // actually on disk; if the save fails, the UI would silently lie.
  if (data.isSaved) {
    handlers.setIsDone(true);
    handlers.setIsDownloading(false);
    handlers.setDownloadProgress(0);
    handlers.setDownloadProgressType("");
    return;
  }

  handlers.setIsDownloading(true);
}
