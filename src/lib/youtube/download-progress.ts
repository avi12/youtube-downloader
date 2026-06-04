import { ProgressType } from "@/types";
import type { Prettify } from "@/types";

const DOWNLOAD_PHASE_WEIGHT = 70;
const MUX_PHASE_WEIGHT = 30;
const MIN_VISIBLE_PERCENT = 0.5;

export const CAPTION_ESTIMATED_BYTES = 50_000;

type CalculateWeightedProgressParams = Prettify<{
  isDownloading: boolean;
  progress: number;
  progressType: ProgressType | "";
}>;
export function calculateWeightedProgress({ isDownloading, progress, progressType }: CalculateWeightedProgressParams) {
  if (!isDownloading) {
    return 0;
  }

  const isMuxProgress = progressType === ProgressType.FFmpeg;
  const weighted = isMuxProgress
    ? DOWNLOAD_PHASE_WEIGHT + progress * MUX_PHASE_WEIGHT
    : progress * DOWNLOAD_PHASE_WEIGHT;

  const hasProgress = progress > 0;
  const isBelowVisibleFloor = weighted < MIN_VISIBLE_PERCENT;
  if (hasProgress && isBelowVisibleFloor) {
    return MIN_VISIBLE_PERCENT;
  }

  return weighted;
}
