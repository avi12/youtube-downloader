import { sendProgressUpdate } from "./progress-fetch";
import { CAPTION_ESTIMATED_BYTES } from "@/lib/youtube/download-progress";
import { ProgressType } from "@/types";

type CreateCdnProgressTrackerParams = {
  videoId: string;
  tabId: number;
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
  videoId, tabId, captionCount, hasVideo, hasAudio, extraCount,
  videoExpectedBytes, audioExpectedBytes, extraExpectedBytesArray, initialVideoBytes, initialAudioBytes
}: CreateCdnProgressTrackerParams) {
  let videoReceivedBytes = initialVideoBytes;
  let audioReceivedBytes = initialAudioBytes;
  let videoTotalBytes = videoExpectedBytes;
  let audioTotalBytes = audioExpectedBytes;
  const extraReceivedBytesArray = Array.from({ length: extraCount }, () => 0);
  const captionBytesTotal = captionCount * CAPTION_ESTIMATED_BYTES;

  function reportProgress() {
    let totalExpected = captionBytesTotal;
    if (hasVideo) {
      totalExpected += videoTotalBytes || videoReceivedBytes;
    }

    if (hasAudio) {
      totalExpected += audioTotalBytes || audioReceivedBytes;
    }

    for (const [i, expected] of extraExpectedBytesArray.entries()) {
      totalExpected += expected || extraReceivedBytesArray[i];
    }

    if (totalExpected === 0) {
      return;
    }

    let received = captionBytesTotal;
    if (hasVideo) {
      const expected = videoTotalBytes || videoReceivedBytes;
      if (expected > 0) {
        received += Math.min(videoReceivedBytes, expected);
      }
    }

    if (hasAudio) {
      const expected = audioTotalBytes || audioReceivedBytes;
      if (expected > 0) {
        received += Math.min(audioReceivedBytes, expected);
      }
    }

    for (const [i, expected] of extraExpectedBytesArray.entries()) {
      const effectiveExpected = expected || extraReceivedBytesArray[i];
      if (effectiveExpected > 0) {
        received += Math.min(extraReceivedBytesArray[i], effectiveExpected);
      }
    }

    void sendProgressUpdate({
      videoId,
      progress: Math.min(received / totalExpected, 1),
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
