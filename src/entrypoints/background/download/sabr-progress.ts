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
  const hasVideoStage = !isAudioOnly && !!videoFormat;
  const totalStages = captionCount + (hasVideoStage ? 1 : 0) + 1 + additionalFormats.length;

  let videoReceivedBytes = 0;
  let audioReceivedBytes = 0;
  const extraReceivedBytesArray = additionalFormats.map(() => 0);

  function computeProgress() {
    if (totalStages === 0) {
      return 0;
    }

    const mediaStages = totalStages - captionCount;
    let mediaCompleted = 0;
    const hasVideoProgress = !isAudioOnly && videoPartBytes > 0;
    if (hasVideoProgress) {
      mediaCompleted += Math.min(videoReceivedBytes / videoPartBytes, 1);
    }

    if (audioPartBytes > 0) {
      mediaCompleted += Math.min(audioReceivedBytes / audioPartBytes, 1);
    }

    for (const [i, expected] of extraExpectedBytesArray.entries()) {
      if (expected > 0) {
        mediaCompleted += Math.min(extraReceivedBytesArray[i] / expected, 1);
      }
    }

    const captionCompleted = mediaCompleted >= mediaStages ? captionCount : 0;
    return Math.min((mediaCompleted + captionCompleted) / totalStages, DOWNLOAD_PROGRESS_CAP);
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
