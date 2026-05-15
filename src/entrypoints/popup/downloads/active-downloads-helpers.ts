import { ProgressType } from "@/types";

export function getProgressLabel({ videoId, statusProgress, percentFormatter }: {
  videoId: string;
  statusProgress: Record<string, {
    progress: number;
    progressType: ProgressType;
  }>;
  percentFormatter: Intl.NumberFormat;
}) {
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

export function getProgress({ videoId, statusProgress }: {
  videoId: string;
  statusProgress: Record<string, {
    progress: number;
    progressType: ProgressType;
  }>;
}) {
  return statusProgress[videoId]?.progress ?? null;
}

export function getFilename({ videoId, videoDetails }: {
  videoId: string;
  videoDetails: Record<string, {
    filenameOutput: string;
    quality?: string;
  }>;
}) {
  return videoDetails[videoId]?.filenameOutput ?? videoId;
}

export function getQuality({ videoId, videoDetails }: {
  videoId: string;
  videoDetails: Record<string, {
    filenameOutput: string;
    quality?: string;
  }>;
}) {
  return videoDetails[videoId]?.quality ?? "";
}

export function getVideoStatusLabel({ i, isFFmpegReady }: {
  i: number;
  isFFmpegReady: boolean;
}) {
  if (i === 0) {
    return isFFmpegReady ? "Processing…" : "Waiting for FFmpeg…";
  }

  return "Downloading";
}

type StatusProgress = Record<string, {
  progress: number;
  progressType: ProgressType;
}>;
type VideoDetails = Record<string, {
  filenameOutput: string;
  quality?: string;
}>;

export function bindDownloadAccessors({ statusProgress, videoDetails, percentFormatter }: {
  statusProgress: StatusProgress;
  videoDetails: VideoDetails;
  percentFormatter: Intl.NumberFormat;
}) {
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
