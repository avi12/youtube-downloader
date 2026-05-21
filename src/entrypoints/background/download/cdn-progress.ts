import { sendProgressUpdate } from "./progress-fetch";
import { ProgressType } from "@/types";

type CreateCdnProgressTrackerParams = {
  videoId: string;
  tabId: number;
  totalStages: number;
  captionCount: number;
  hasVideo: boolean;
  hasAudio: boolean;
  extraCount: number;
  videoExpectedBytes: number;
  audioExpectedBytes: number;
  extraExpectedBytesArray: number[];
  initialVideoBytes: number;
  initialAudioBytes: number;
};
export function createCdnProgressTracker({
  videoId, tabId, totalStages, captionCount, hasVideo, hasAudio, extraCount,
  videoExpectedBytes, audioExpectedBytes, extraExpectedBytesArray, initialVideoBytes, initialAudioBytes
}: CreateCdnProgressTrackerParams) {
  let videoReceivedBytes = initialVideoBytes;
  let audioReceivedBytes = initialAudioBytes;
  let videoTotalBytes = videoExpectedBytes;
  let audioTotalBytes = audioExpectedBytes;
  const extraReceivedBytesArray = Array.from({ length: extraCount }, () => 0);

  function reportProgress() {
    if (totalStages === 0) {
      return;
    }

    const mediaStages = totalStages - captionCount;
    let mediaCompleted = 0;
    if (hasVideo) {
      const expected = videoTotalBytes || videoReceivedBytes;
      if (expected > 0) {
        mediaCompleted += Math.min(videoReceivedBytes / expected, 1);
      }
    }

    if (hasAudio) {
      const expected = audioTotalBytes || audioReceivedBytes;
      if (expected > 0) {
        mediaCompleted += Math.min(audioReceivedBytes / expected, 1);
      }
    }

    for (const [i, expected] of extraExpectedBytesArray.entries()) {
      const effectiveExpected = expected || extraReceivedBytesArray[i];
      if (effectiveExpected > 0) {
        mediaCompleted += Math.min(extraReceivedBytesArray[i] / effectiveExpected, 1);
      }
    }

    const captionCompleted = mediaCompleted >= mediaStages ? captionCount : 0;
    const completed = mediaCompleted + captionCompleted;

    void sendProgressUpdate({
      videoId,
      progress: Math.min(completed / totalStages, 1),
      progressType: ProgressType.Video,
      tabId
    });
  }

  return {
    onVideoBytes(bytes: number) {
      videoReceivedBytes += bytes;
      videoTotalBytes = Math.max(videoTotalBytes, videoReceivedBytes);
      reportProgress();
    },
    onAudioBytes(bytes: number) {
      audioReceivedBytes += bytes;
      audioTotalBytes = Math.max(audioTotalBytes, audioReceivedBytes);
      reportProgress();
    },
    onExtraBytes({ i, bytes }: {
      i: number;
      bytes: number;
    }) {
      extraReceivedBytesArray[i] += bytes;
      reportProgress();
    }
  };
}
