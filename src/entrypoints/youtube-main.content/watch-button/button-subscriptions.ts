import type { ButtonElements } from "./button-handlers";
import { refreshButtons } from "./button-handlers";
import { handleProgressEvent } from "./button-handlers";
import type { ButtonState } from "./button-state";
import { CrossWorldEvent, onCrossWorldEvent } from "@/lib/messaging/cross-world-events";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";
import type { VideoData } from "@/types";

export function wireButtonSubscriptions(
  state: ButtonState,
  videoData: VideoData,
  elements: ButtonElements,
  applySegmentedClasses: () => void
): () => void {
  const unsubscribeProgress = onCrossWorldEvent({
    type: CrossWorldEvent.ProgressUpdate,
    handler: data => handleProgressEvent({ data }, state, videoData, elements, applySegmentedClasses)
  });

  const unsubscribePanelClosed = crossWorldMessenger.onMessage(CrossWorldMessage.PanelClosed, () => {
    if (!state.isPanelOpen) {
      return;
    }

    state.isPanelOpen = false;
    refreshButtons(state, videoData, elements, applySegmentedClasses);
    elements.elDropdown.close();
  });

  const unsubscribeFilenameChanged = crossWorldMessenger.onMessage(CrossWorldMessage.FilenameChanged, ({ data }) => {
    state.defaultFilename = data.filename;
    state.defaultQuality = data.quality ?? "";

    if (data.videoItag !== undefined) {
      state.defaultVideoItag = data.videoItag;
    }

    if (data.audioItag !== undefined) {
      state.defaultAudioItag = data.audioItag;
    }

    refreshButtons(state, videoData, elements, applySegmentedClasses);
  });

  return () => {
    unsubscribeProgress();
    unsubscribePanelClosed();
    unsubscribeFilenameChanged();
  };
}
