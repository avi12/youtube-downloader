import { createAudioTrackState } from "./DownloadOptionsPanel.audio.svelte";
import { createCaptionTrackState } from "./DownloadOptionsPanel.caption.svelte";
import { createDownloadProgressTracker } from "./DownloadOptionsPanel.progress.svelte";
import { createVideoFormatTracker } from "./DownloadOptionsPanel.video-format.svelte";
import {
  resolveInitialAudioCustomLanguage,
  resolveInitialAudioMode,
  resolveInitialCaptionMode,
  resolveInitialCaptionTrack
} from "./helpers/panel-init";
import { CONTENT_OPTIONS } from "@/lib/ui/synced-stores.svelte";
import type { AdaptiveFormatItem, VideoData } from "@/types";
import { untrack } from "svelte";

export function createTrackStates({
  getVideoData,
  setSelectedAudioFormat,
  setSelectedVideoFormat,
  resetDoneState,
  setDownloadId
}: {
  getVideoData: () => VideoData;
  setSelectedAudioFormat: (value: AdaptiveFormatItem | null) => void;
  setSelectedVideoFormat: (value: AdaptiveFormatItem | null) => void;
  resetDoneState: () => void;
  setDownloadId: (value: number | null) => void;
}) {
  const audio = untrack(() => {
    const options = CONTENT_OPTIONS;
    const videoData = getVideoData();
    return createAudioTrackState({
      getVideoData,
      setSelectedAudioFormat,
      resetDoneState,
      initialMode: resolveInitialAudioMode({
        options,
        videoData
      }),
      initialCustomLanguage: resolveInitialAudioCustomLanguage({
        options,
        videoData
      })
    });
  });

  const caption = untrack(() => {
    const options = CONTENT_OPTIONS;
    const videoData = getVideoData();
    const initialMode = resolveInitialCaptionMode({
      options,
      videoData
    });
    return createCaptionTrackState({
      getVideoData,
      initialMode,
      initialTrack: resolveInitialCaptionTrack({
        captionMode: initialMode,
        options,
        videoData
      })
    });
  });

  createVideoFormatTracker({
    getVideoData,
    setSelectedVideoFormat
  });
  createDownloadProgressTracker({
    getVideoData,
    setDownloadId
  });

  return {
    audio,
    caption
  };
}
