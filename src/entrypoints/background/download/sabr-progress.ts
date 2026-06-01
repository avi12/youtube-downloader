import { sendProgressUpdate } from "./progress-fetch";
import { computeWeightedProgress } from "./progress-stages";
import { parseContentLength, estimateFormatBytes } from "./sabr-utils";
import { ProgressType } from "@/types";
import type { AdaptiveFormatItem } from "@/types";

type CreateProgressAccumulatorParams = {
  videoId: string;
  tabId: number;
  captionCount: number;
  isAudioOnly: boolean;
  videoFormat: AdaptiveFormatItem | null;
  audioFormat: AdaptiveFormatItem;
  additionalFormats: AdaptiveFormatItem[];
  onProgress?: () => void;
};
export function createProgressAccumulator({
  videoId, tabId, captionCount, isAudioOnly, videoFormat, audioFormat, additionalFormats, onProgress
}: CreateProgressAccumulatorParams) {
  const hasVideoStage = !isAudioOnly && !!videoFormat;
  const videoExpectedBytes = hasVideoStage ? parseContentLength(videoFormat) : 0;
  const audioExpectedBytes = parseContentLength(audioFormat);
  const extraExpectedBytesArray = additionalFormats.map(format => {
    const known = parseContentLength(format);
    return known > 0 ? known : estimateFormatBytes({
      format,
      referenceFormat: audioFormat
    });
  });
  let videoReceivedBytes = 0;
  let audioReceivedBytes = 0;
  const extraReceivedBytesArray = additionalFormats.map(() => 0);

  function emit() {
    const progress = computeWeightedProgress({
      hasVideoStage,
      videoReceivedBytes,
      videoExpectedBytes,
      hasAudioStage: true,
      audioReceivedBytes,
      audioExpectedBytes,
      extraReceivedBytesArray,
      extraExpectedBytesArray,
      captionCount
    });
    onProgress?.();
    const extraReceived = extraReceivedBytesArray.reduce((acc, n) => acc + n, 0);
    const extraExpected = extraExpectedBytesArray.reduce((acc, n) => acc + n, 0);
    const downloadedBytes = videoReceivedBytes + audioReceivedBytes + extraReceived;
    const expectedBytes = videoExpectedBytes + audioExpectedBytes + extraExpected;
    sendProgressUpdate({
      videoId,
      progress,
      progressType: ProgressType.Video,
      tabId,
      downloadedBytes,
      ...(expectedBytes > 0 && {
        totalBytes: expectedBytes
      })
    });
  }

  return {
    onVideoBytes(bytes: number) {
      videoReceivedBytes += bytes;
      emit();
    },
    onAudioBytes(bytes: number) {
      audioReceivedBytes += bytes;
      emit();
    },
    onExtraTrackBytes({ trackIndex, bytes }: {
      trackIndex: number;
      bytes: number;
    }) {
      extraReceivedBytesArray[trackIndex] += bytes;
      emit();
    }
  };
}
