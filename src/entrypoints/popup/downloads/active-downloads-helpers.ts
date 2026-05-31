import { calculateWeightedProgress } from "@/lib/youtube/video-helpers";
import { ProgressType } from "@/types";
import type { DownloadProgressEntry } from "@/types";

const PERCENT_COMPLETE = 100;

type StatusProgress = Record<string, DownloadProgressEntry>;
type VideoDetails = Record<string, {
  filenameOutput: string;
  quality?: string;
  tabId?: number;
  playlistId?: string;
  playlistTitle?: string;
  sourceUrl?: string;
}>;

function computeWeightedFraction(entry: StatusProgress[string]) {
  return calculateWeightedProgress({
    isDownloading: true,
    progress: entry.progress,
    progressType: entry.progressType
  }) / PERCENT_COMPLETE;
}

type GetProgressLabelParams = {
  videoId: string;
  statusProgress: StatusProgress;
  percentFormatter: Intl.NumberFormat;
};
export function getProgressLabel({ videoId, statusProgress, percentFormatter }: GetProgressLabelParams) {
  const progressEntry = statusProgress[videoId];
  if (!progressEntry) {
    return "";
  }

  const percentage = percentFormatter.format(computeWeightedFraction(progressEntry));
  const isFfmpegProgress = progressEntry.progressType === ProgressType.FFmpeg;
  if (isFfmpegProgress) {
    return `${percentage} processed`;
  }

  return `${percentage} downloaded`;
}

type GetProgressParams = {
  videoId: string;
  statusProgress: StatusProgress;
};
export function getProgress({ videoId, statusProgress }: GetProgressParams) {
  const progressEntry = statusProgress[videoId];
  if (!progressEntry) {
    return null;
  }

  return computeWeightedFraction(progressEntry);
}

type VideoIdDetailsParams = {
  videoId: string;
  videoDetails: VideoDetails;
};
export function getFilename({ videoId, videoDetails }: VideoIdDetailsParams) {
  return videoDetails[videoId]?.filenameOutput ?? videoId;
}

export function getQuality({ videoId, videoDetails }: VideoIdDetailsParams) {
  return videoDetails[videoId]?.quality ?? "";
}

type GetVideoStatusLabelParams = {
  i: number;
  isFFmpegReady: boolean;
};
export function getVideoStatusLabel({ i, isFFmpegReady }: GetVideoStatusLabelParams) {
  const isFirstItem = i === 0;
  if (isFirstItem) {
    return isFFmpegReady ? "Processing…" : "Waiting for FFmpeg…";
  }

  return "Downloading";
}

type BindDownloadAccessorsParams = {
  statusProgress: StatusProgress;
  videoDetails: VideoDetails;
  percentFormatter: Intl.NumberFormat;
};
export function bindDownloadAccessors({ statusProgress, videoDetails, percentFormatter }: BindDownloadAccessorsParams) {
  return {
    label: (id: string) => getProgressLabel({
      videoId: id,
      statusProgress,
      percentFormatter
    }),
    progress: (id: string) => getProgress({
      videoId: id,
      statusProgress
    }),
    filename: (id: string) => getFilename({
      videoId: id,
      videoDetails
    }),
    quality: (id: string) => getQuality({
      videoId: id,
      videoDetails
    })
  };
}
