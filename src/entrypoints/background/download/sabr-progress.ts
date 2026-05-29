import { sendProgressUpdate } from "./progress-fetch";
import { parseContentLength, estimateFormatBytes } from "./sabr-utils";
import { CAPTION_ESTIMATED_BYTES } from "@/lib/youtube/download-progress";
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
  const captionBytesTotal = captionCount * CAPTION_ESTIMATED_BYTES;
  const totalExpectedBytes = videoPartBytes
    + audioPartBytes
    + extraExpectedBytesArray.reduce((sum, bytes) => sum + bytes, 0)
    + captionBytesTotal;

  let videoReceivedBytes = 0;
  let audioReceivedBytes = 0;
  const extraReceivedBytesArray = additionalFormats.map(() => 0);

  function computeProgress() {
    if (totalExpectedBytes === 0) {
      return 0;
    }

    let received = 0;
    if (isVideoStagePresent) {
      received += Math.min(videoReceivedBytes, videoPartBytes);
    }

    if (isAudioStagePresent) {
      received += Math.min(audioReceivedBytes, audioPartBytes);
    }

    for (const [i, expected] of extraExpectedBytesArray.entries()) {
      if (expected > 0) {
        received += Math.min(extraReceivedBytesArray[i], expected);
      }
    }

    // Captions are pre-fetched on the page before the worker starts, so by the
    // time we reach this point they're already complete and contribute their
    // (small) byte share of the download phase.
    received += captionBytesTotal;

    return Math.min(received / totalExpectedBytes, DOWNLOAD_PROGRESS_CAP);
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
