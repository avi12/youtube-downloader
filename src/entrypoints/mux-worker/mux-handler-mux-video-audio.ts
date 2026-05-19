import { executeMuxPhases, tryCheckOutput } from "./mux-handler-exec";
import { cleanupMuxFiles, writeMuxInputFiles } from "./mux-handler-files";
import { postFileResult, state, tryRmdir, tryUnmount } from "./mux-state";
import { cleanupOpfsOutput, createOpfsOutputFs, createOpfsOutputHandle } from "./opfs-output-fs";
import type { MuxVideoAudioJob } from "@/lib/download-pipeline/mux-worker-types";
import {
  getAudioTempExtension,
  getCompatibleFilename,
  getVideoTempExtension,
  isVideoNativeForContainer
} from "@/lib/utils/containers";

const WORKERFS_MOUNT_SUFFIX = "-opfs-in";
const OPFS_OUT_SUFFIX = "-opfs-out";

export async function handleMuxVideoAudio(job: MuxVideoAudioJob) {
  const {
    videoData, videoFile, audioData, extraAudioTracks, subtitleTracks,
    videoMimeType, audioMimeType, videoId, tabId,
    primaryAudioLabel, primaryAudioLanguageCode, defaultAudioTrackIndex, filenameOutput
  } = job;
  state.currentVideoId = videoId;
  state.currentTabId = tabId;

  const isExtraTracksPresent = extraAudioTracks.length > 0;
  const filenameBase = filenameOutput.replace(/\.[^.]+$/, "");
  const targetExtension = isExtraTracksPresent ? "mkv" : (filenameOutput.split(".").pop() ?? "mkv");
  const muxFilename = getCompatibleFilename(`${videoId}-mux.mkv`);
  const outputFilename = targetExtension !== "mkv"
    ? getCompatibleFilename(`${videoId}-${filenameBase}.${targetExtension}`)
    : muxFilename;
  const useIntermediateMkv = targetExtension !== "mkv" && !isVideoNativeForContainer({
    videoMimeType,
    targetExtension
  });

  const isWorkerfsVideo = !!videoFile;
  const workerfsDir = `/${videoId}${WORKERFS_MOUNT_SUFFIX}`;

  let videoFilename: string;
  if (isWorkerfsVideo) {
    state.ffmpeg!.FS.mkdir(workerfsDir);
    state.ffmpeg!.FS.mount(state.ffmpeg!.FS.filesystems.WORKERFS, { files: [videoFile] }, workerfsDir);
    videoFilename = `${workerfsDir}/${videoFile.name}`;
  } else {
    videoFilename = `${videoId}-video.${getVideoTempExtension(videoMimeType)}`;
  }

  const primaryAudioFilename = `${videoId}-audio.${getAudioTempExtension(audioMimeType)}`;

  state.progressOffset = 0;
  state.progressScale = useIntermediateMkv ? 0.5 : 1;

  const { extraFilenames, subtitleFilenames } = writeMuxInputFiles({
    videoId,
    videoFilename,
    videoData: videoData ?? new ArrayBuffer(0),
    skipVideoWrite: isWorkerfsVideo,
    primaryAudioFilename,
    audioData,
    audioMimeType,
    extraAudioTracks,
    subtitleTracks
  });

  const outputHandle = await createOpfsOutputHandle(videoId);
  const syncHandle = await outputHandle.createSyncAccessHandle();
  const opfsOutDir = `/${videoId}${OPFS_OUT_SUFFIX}`;
  const outputDriver = createOpfsOutputFs(state.ffmpeg!.FS, syncHandle, outputFilename);
  state.ffmpeg!.FS.mkdir(opfsOutDir);
  state.ffmpeg!.FS.mount(outputDriver, {}, opfsOutDir);
  const opfsOutputFilename = `${opfsOutDir}/${outputFilename}`;

  let success: boolean | undefined;
  try {
    success = executeMuxPhases(
      {
        videoFilename,
        primaryAudioFilename,
        extraFilenames,
        subtitleFilenames,
        outputFilename: opfsOutputFilename,
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
      },
      filename => filename === opfsOutputFilename
        ? syncHandle.getSize() > 0
        : tryCheckOutput(filename)
    );
  } finally {
    syncHandle.close();
    tryUnmount(opfsOutDir);
    tryRmdir(opfsOutDir);
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

    if (isWorkerfsVideo) {
      tryUnmount(workerfsDir);
      tryRmdir(workerfsDir);
    }
  }

  if (success) {
    const file = await outputHandle.getFile();
    postFileResult(file);
  } else {
    await cleanupOpfsOutput(videoId);
  }
}
