import type { Prettify } from "@/types";

// Equal-weight stages: every component (video, primary audio, each additional
// audio track, each caption) gets exactly the same share of the 0-70% UI
// download phase. Total stages = totalStages above. Each stage contributes
// 1/totalStages = (70 / totalStages)% of the watch-button ring.
//
// Captions ship pre-fetched in the DownloadRequest (`captionVttData` is
// populated in the watch-page content script before the BG ever sees the
// request), so they have no streaming progress of their own and count as
// fully complete from the moment the accumulator starts; the bar begins at
// captionCount/totalStages and the remaining range fills as media streams in.

type ComputeWeightedProgressParams = Prettify<{
  hasVideoStage: boolean;
  videoReceivedBytes: number;
  videoExpectedBytes: number;
  hasAudioStage: boolean;
  audioReceivedBytes: number;
  audioExpectedBytes: number;
  extraReceivedBytesArray: number[];
  extraExpectedBytesArray: number[];
  captionCount: number;
}>;
export function computeWeightedProgress({
  hasVideoStage, videoReceivedBytes, videoExpectedBytes,
  hasAudioStage, audioReceivedBytes, audioExpectedBytes,
  extraReceivedBytesArray, extraExpectedBytesArray,
  captionCount
}: ComputeWeightedProgressParams) {
  const isVideoValid = hasVideoStage && videoExpectedBytes > 0;
  const isAudioValid = hasAudioStage && audioExpectedBytes > 0;
  const validExtraIndices: number[] = [];
  for (const [i, expected] of extraExpectedBytesArray.entries()) {
    if (expected > 0) {
      validExtraIndices.push(i);
    }
  }

  const mediaStageCount = (isVideoValid ? 1 : 0) + (isAudioValid ? 1 : 0) + validExtraIndices.length;
  const totalStages = mediaStageCount + captionCount;
  if (totalStages === 0) {
    return 0;
  }

  let completed = captionCount;
  if (isVideoValid) {
    completed += Math.min(videoReceivedBytes / videoExpectedBytes, 1);
  }

  if (isAudioValid) {
    completed += Math.min(audioReceivedBytes / audioExpectedBytes, 1);
  }

  for (const i of validExtraIndices) {
    completed += Math.min(extraReceivedBytesArray[i] / extraExpectedBytesArray[i], 1);
  }

  return Math.min(completed / totalStages, 1);
}
