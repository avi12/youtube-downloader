import { toOwnedArrayBuffer, reportProgress } from ".";
import { runEmbedMetadata, runTranscodeAudio } from "./ffmpeg-instance";
import { ProgressType } from "@/types";
import type { Prettify, VideoMetadata } from "@/types";

const WEBA_EXTENSION = "weba";
const WEBM_EXTENSION = "webm";
const WEBM_AUDIO_OUTPUT_EXTENSIONS = new Set([WEBA_EXTENSION, WEBM_EXTENSION]);

type ApplyAudioFfmpegParams = Prettify<{
  videoId: string;
  tabId: number;
  data: Uint8Array;
  sourceExtension: string;
  audioMimeType?: string;
  filenameOutput: string;
  outputExtension: string;
  metadata?: VideoMetadata | null;
}>;
export async function applyAudioFfmpeg({
  videoId,
  tabId,
  data,
  sourceExtension,
  audioMimeType,
  filenameOutput,
  outputExtension,
  metadata
}: ApplyAudioFfmpegParams) {
  const isWebmOutput = WEBM_AUDIO_OUTPUT_EXTENSIONS.has(outputExtension);
  const hasEmbeddableThumbnail = metadata != null && Boolean(metadata.thumbnailUrl) && !isWebmOutput;
  if (hasEmbeddableThumbnail) {
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
        audioMimeType,
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
