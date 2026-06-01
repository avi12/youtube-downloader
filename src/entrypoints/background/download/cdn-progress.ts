import { sendProgressUpdate } from "./progress-fetch";
import { computeWeightedProgress } from "./progress-stages";
import { ProgressType } from "@/types";

type CreateCdnProgressTrackerParams = {
  videoId: string;
  tabId: number;
  captionCount: number;
  hasVideo: boolean;
  hasAudio: boolean;
  videoExpectedBytes: number;
  audioExpectedBytes: number;
  extraExpectedBytesArray: number[];
  initialVideoBytes: number;
  initialAudioBytes: number;
};
export function createCdnProgressTracker({
  videoId, tabId, captionCount, hasVideo, hasAudio,
  videoExpectedBytes, audioExpectedBytes, extraExpectedBytesArray, initialVideoBytes, initialAudioBytes
}: CreateCdnProgressTrackerParams) {
  let videoReceivedBytes = initialVideoBytes;
  let audioReceivedBytes = initialAudioBytes;
  let videoTotalBytes = videoExpectedBytes;
  let audioTotalBytes = audioExpectedBytes;
  const extraReceivedBytesArray = Array.from({ length: extraExpectedBytesArray.length }, () => 0);

  function emit() {
    const progress = computeWeightedProgress({
      hasVideoStage: hasVideo,
      videoReceivedBytes,
      videoExpectedBytes: videoTotalBytes,
      hasAudioStage: hasAudio,
      audioReceivedBytes,
      audioExpectedBytes: audioTotalBytes,
      extraReceivedBytesArray,
      extraExpectedBytesArray,
      captionCount
    });
    sendProgressUpdate({
      videoId,
      progress,
      progressType: ProgressType.Video,
      tabId
    });
  }

  return {
    onVideoBytes(bytes: number) {
      videoReceivedBytes += bytes;
      videoTotalBytes = Math.max(videoTotalBytes, videoReceivedBytes);
      emit();
    },
    onAudioBytes(bytes: number) {
      audioReceivedBytes += bytes;
      audioTotalBytes = Math.max(audioTotalBytes, audioReceivedBytes);
      emit();
    },
    onExtraBytes({ i, bytes }: {
      i: number;
      bytes: number;
    }) {
      extraReceivedBytesArray[i] += bytes;
      emit();
    }
  };
}
