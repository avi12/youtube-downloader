import { mapToBarProgress, refreshButtons } from "./button-handlers";
import type { ButtonElements } from "./button-handlers";
import type { ButtonState } from "./button-state";
import { ProgressType, type ProgressUpdate, type VideoData } from "@/types";

export function handleProgressEvent(
  { data }: { data: ProgressUpdate },
  state: ButtonState,
  videoData: VideoData,
  elements: ButtonElements,
  applySegmentedClasses: () => void
) {
  if (data.videoId !== videoData.videoId) {
    return;
  }

  if (!data.isRemoved && data.progress === state.lastProgressReported) {
    return;
  }

  state.lastProgressReported = data.isRemoved ? -1 : data.progress;

  if (data.isRemoved) {
    state.isDownloading = false;
    state.downloadProgress = 0;
    state.downloadProgressType = "";
    refreshButtons(state, videoData, elements, applySegmentedClasses);
    return;
  }

  state.downloadProgress = mapToBarProgress(data.progress, data.progressType);
  state.downloadProgressType = data.progressType;

  if (data.progress >= 1 && data.progressType === ProgressType.FFmpeg) {
    state.isDone = true;
    state.isDownloading = false;
    state.downloadProgress = 0;
    state.downloadProgressType = "";
  }

  refreshButtons(state, videoData, elements, applySegmentedClasses);
}
