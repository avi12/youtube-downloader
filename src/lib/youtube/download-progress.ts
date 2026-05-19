import { ProgressType } from "@/types";

const DOWNLOAD_PHASE_WEIGHT = 70;
const MUX_PHASE_WEIGHT = 30;

type CalculateWeightedProgressParams = {
  isDownloading: boolean;
  progress: number;
  progressType: ProgressType | "";
};
export function calculateWeightedProgress({ isDownloading, progress, progressType }: CalculateWeightedProgressParams) {
  if (!isDownloading) {
    return 0;
  }

  const isMuxProgress = progressType === ProgressType.FFmpeg;
  if (isMuxProgress) {
    return DOWNLOAD_PHASE_WEIGHT + progress * MUX_PHASE_WEIGHT;
  }

  return progress * DOWNLOAD_PHASE_WEIGHT;
}
