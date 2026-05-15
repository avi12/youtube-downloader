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

  const reportedKey = data.isRemoved ? "" : `${data.progress}|${data.progressType}`;
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

  const isProcessingComplete = data.progress >= 1 && data.progressType === ProgressType.FFmpeg;
  if (isProcessingComplete) {
    handlers.setIsDone(true);
    handlers.setIsDownloading(false);
    handlers.setDownloadProgress(0);
    handlers.setDownloadProgressType("");
  } else {
    handlers.setIsDownloading(true);
  }
}
