import { toOwnedArrayBuffer, reportProgress } from ".";
import { runEmbedMetadata, runTranscodeAudio } from "./ffmpeg-instance";
import { ProgressType } from "@/types";
import type { VideoMetadata } from "@/types";

const WEBA_EXTENSION = "weba";
const WEBM_EXTENSION = "webm";

type ApplyAudioFfmpegParams = {
  videoId: string;
  tabId: number;
  data: Uint8Array;
  sourceExtension: string;
  filenameOutput: string;
  outputExtension: string;
  metadata?: VideoMetadata | null;
};
export async function applyAudioFfmpeg({
  videoId,
  tabId,
  data,
  sourceExtension,
  filenameOutput,
  outputExtension,
  metadata
}: ApplyAudioFfmpegParams) {
  const isMusicMetadata = metadata?.isMusic;
  if (isMusicMetadata) {
    await reportProgress({
      videoId,
      progress: 0,
      progressType: ProgressType.FFmpeg,
      tabId
    });
    return runEmbedMetadata({
      videoId,
      job: {
        audioData: toOwnedArrayBuffer(data),
        filenameOutput,
        sourceExtension,
        metadata,
        thumbnailUrl: metadata.thumbnailUrl,
        videoId,
        tabId
      }
    });
  }

  const isMatchingExtension = sourceExtension === outputExtension;
  const isWebaToWebm = sourceExtension === WEBA_EXTENSION && outputExtension === WEBM_EXTENSION;
  const isNativeContainer = isMatchingExtension || isWebaToWebm;
  if (!isNativeContainer) {
    await reportProgress({
      videoId,
      progress: 0,
      progressType: ProgressType.FFmpeg,
      tabId
    });
    return runTranscodeAudio({
      videoId,
      job: {
        audioData: toOwnedArrayBuffer(data),
        sourceExtension,
        filenameOutput,
        videoId,
        tabId
      }
    });
  }

  return data;
}
