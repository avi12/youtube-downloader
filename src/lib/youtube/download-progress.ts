import { ProgressType } from "@/types";

const DOWNLOAD_PHASE_WEIGHT = 70;
const MUX_PHASE_WEIGHT = 30;

export function calculateWeightedProgress({ isDownloading, progress, progressType }: {
  isDownloading: boolean;
  progress: number;
  progressType: ProgressType | "";
}) {
  if (!isDownloading) {
    return 0;
  }

  if (progressType === ProgressType.FFmpeg) {
    return DOWNLOAD_PHASE_WEIGHT + progress * MUX_PHASE_WEIGHT;
  }

  return progress * DOWNLOAD_PHASE_WEIGHT;
}
