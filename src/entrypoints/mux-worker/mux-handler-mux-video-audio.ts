import { executeMuxPhases } from "./mux-handler-exec";
import { cleanupMuxFiles, writeMuxInputFiles } from "./mux-handler-files";
import { state } from "./mux-state";
import type { MuxVideoAudioJob } from "@/lib/download-pipeline/mux-worker-types";
import {
  getAudioTempExtension,
  getCompatibleFilename,
  getVideoTempExtension,
  isVideoNativeForContainer
} from "@/lib/utils/containers";

export function handleMuxVideoAudio(job: MuxVideoAudioJob) {
  const {
    videoData, audioData, extraAudioTracks, subtitleTracks,
    videoMimeType, audioMimeType, videoId, tabId,
    primaryAudioLabel, primaryAudioLanguageCode, defaultAudioTrackIndex, filenameOutput
  } = job;
  state.currentVideoId = videoId;
  state.currentTabId = tabId;

  const isExtraTracksPresent = extraAudioTracks.length > 0;
  const filenameBase = filenameOutput.replace(/\.[^.]+$/, "");
  const targetExtension = isExtraTracksPresent ? "mkv" : (filenameOutput.split(".").pop() ?? "mkv");
  const videoFilename = `${videoId}-video.${getVideoTempExtension(videoMimeType)}`;
  const primaryAudioFilename = `${videoId}-audio.${getAudioTempExtension(audioMimeType)}`;
  const muxFilename = getCompatibleFilename(`${videoId}-mux.mkv`);
  const outputFilename = targetExtension !== "mkv"
    ? getCompatibleFilename(`${videoId}-${filenameBase}.${targetExtension}`)
    : muxFilename;
  const useIntermediateMkv = targetExtension !== "mkv" && !isVideoNativeForContainer({
    videoMimeType,
    targetExtension
  });

  state.progressOffset = 0;
  state.progressScale = useIntermediateMkv ? 0.5 : 1;

  const { extraFilenames, subtitleFilenames } = writeMuxInputFiles({
    videoId,
    videoFilename,
    videoData,
    primaryAudioFilename,
    audioData,
    audioMimeType,
    extraAudioTracks,
    subtitleTracks
  });

  try {
    executeMuxPhases({
      videoFilename,
      primaryAudioFilename,
      extraFilenames,
      subtitleFilenames,
      outputFilename,
      muxFilename,
      useIntermediateMkv,
      audioMimeType,
      targetExtension,
      extraAudioTracks,
      subtitleTracks,
      primaryAudioLabel,
      primaryAudioLanguageCode,
      defaultAudioTrackIndex,
      isExtraTracksPresent
    });
  } finally {
    cleanupMuxFiles({
      videoFilename,
      primaryAudioFilename,
      extraFilenames,
      subtitleFilenames,
      muxFilename,
      outputFilename,
      useIntermediateMkv,
      targetExtension
    });
  }
}
