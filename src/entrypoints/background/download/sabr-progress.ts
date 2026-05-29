import { sendProgressUpdate } from "./progress-fetch";
import { parseContentLength, estimateFormatBytes } from "./sabr-utils";
import { ProgressType } from "@/types";
import type { AdaptiveFormatItem } from "@/types";

const DOWNLOAD_PROGRESS_CAP = 1;

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
  const videoPartBytes = isAudioOnly ? 0 : parseContentLength(videoFormat);
  const audioPartBytes = parseContentLength(audioFormat);
  const extraExpectedBytesArray = additionalFormats.map(format => {
    const known = parseContentLength(format);
    return known > 0 ? known : estimateFormatBytes({
      format,
      referenceFormat: audioFormat
    });
  });
  const isVideoStagePresent = !isAudioOnly && videoPartBytes > 0;
  const isAudioStagePresent = audioPartBytes > 0;
  const additionalFormatCount = additionalFormats.length;
  const totalStages = captionCount
    + (isVideoStagePresent ? 1 : 0)
    + (isAudioStagePresent ? 1 : 0)
    + additionalFormatCount;

  let videoReceivedBytes = 0;
  let audioReceivedBytes = 0;
  const extraReceivedBytesArray = additionalFormats.map(() => 0);

  function computeProgress() {
    if (totalStages === 0) {
      return 0;
    }

    let mediaCompleted = 0;
    if (isVideoStagePresent) {
      mediaCompleted += Math.min(videoReceivedBytes / videoPartBytes, 1);
    }

    if (isAudioStagePresent) {
      mediaCompleted += Math.min(audioReceivedBytes / audioPartBytes, 1);
    }

    for (const [i, expected] of extraExpectedBytesArray.entries()) {
      if (expected > 0) {
        mediaCompleted += Math.min(extraReceivedBytesArray[i] / expected, 1);
      }
    }

    // Captions are pre-fetched on the page before the worker starts, so by the
    // time we reach this point they're already complete and contribute their
    // proportional share of the download phase.
    return Math.min((mediaCompleted + captionCount) / totalStages, DOWNLOAD_PROGRESS_CAP);
  }

  function sendUpdate() {
    onProgress?.();
    void sendProgressUpdate({
      videoId,
      progress: computeProgress(),
      progressType: ProgressType.Video,
      tabId
    });
  }

  return {
    onVideoBytes(bytes: number) {
      videoReceivedBytes += bytes; sendUpdate();
    },
    onAudioBytes(bytes: number) {
      audioReceivedBytes += bytes; sendUpdate();
    },
    onExtraTrackBytes({ trackIndex, bytes }: {
      trackIndex: number;
      bytes: number;
    }) {
      extraReceivedBytesArray[trackIndex] += bytes;
      sendUpdate();
    }
  };
}
