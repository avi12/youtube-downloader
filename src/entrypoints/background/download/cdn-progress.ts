import { sendProgressUpdate } from "./progress-fetch";
import { ProgressType } from "@/types";

export function createCdnProgressTracker({
  videoId, tabId, totalStages, captionCount, hasVideo, hasAudio, extraCount,
  videoExpectedBytes, audioExpectedBytes, extraExpectedBytesArr, initialVideoBytes, initialAudioBytes
}: {
  videoId: string;
  tabId: number;
  totalStages: number;
  captionCount: number;
  hasVideo: boolean;
  hasAudio: boolean;
  extraCount: number;
  videoExpectedBytes: number;
  audioExpectedBytes: number;
  extraExpectedBytesArr: number[];
  initialVideoBytes: number;
  initialAudioBytes: number;
}) {
  let videoReceivedBytes = initialVideoBytes;
  let audioReceivedBytes = initialAudioBytes;
  let videoTotalBytes = videoExpectedBytes;
  let audioTotalBytes = audioExpectedBytes;
  const extraReceivedBytesArr = Array.from({ length: extraCount }, () => 0);

  function reportProgress() {
    if (totalStages === 0) {
      return;
    }

    let completed = captionCount;
    if (hasVideo) {
      const expected = videoTotalBytes || videoReceivedBytes;
      if (expected > 0) {
        completed += Math.min(videoReceivedBytes / expected, 1);
      }
    }

    if (hasAudio) {
      const expected = audioTotalBytes || audioReceivedBytes;
      if (expected > 0) {
        completed += Math.min(audioReceivedBytes / expected, 1);
      }
    }

    for (const [i, expected] of extraExpectedBytesArr.entries()) {
      const effectiveExpected = expected || extraReceivedBytesArr[i];
      if (effectiveExpected > 0) {
        completed += Math.min(extraReceivedBytesArr[i] / effectiveExpected, 1);
      }
    }

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
    onExtraBytes(i: number, bytes: number) {
      extraReceivedBytesArr[i] += bytes;
      reportProgress();
    }
  };
}
