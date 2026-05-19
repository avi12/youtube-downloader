import { ProgressType } from "@/types";

type StatusProgress = Record<string, {
  progress: number;
  progressType: ProgressType;
}>;
type VideoDetails = Record<string, {
  filenameOutput: string;
  quality?: string;
  tabId?: number;
  playlistId?: string;
  playlistTitle?: string;
}>;

type GetProgressLabelParams = {
  videoId: string;
  statusProgress: StatusProgress;
  percentFormatter: Intl.NumberFormat;
};
export function getProgressLabel({ videoId, statusProgress, percentFormatter }: GetProgressLabelParams) {
  const prog = statusProgress[videoId];
  if (!prog) {
    return "";
  }

  const percentage = percentFormatter.format(prog.progress);
  if (prog.progressType === ProgressType.FFmpeg) {
    return `${percentage} stitching`;
  }

  return `${percentage} (${prog.progressType})`;
}

type GetProgressParams = {
  videoId: string;
  statusProgress: StatusProgress;
};
export function getProgress({ videoId, statusProgress }: GetProgressParams) {
  return statusProgress[videoId]?.progress ?? null;
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
  if (i === 0) {
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
