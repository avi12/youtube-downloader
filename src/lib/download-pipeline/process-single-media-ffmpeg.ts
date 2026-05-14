import { toOwnedArrayBuffer, reportProgress } from ".";
import { runEmbedMetadata, runTranscodeAudio } from "./ffmpeg-instance";
import { ProgressType } from "@/types";
import type { VideoMetadata } from "@/types";

export async function applyAudioFfmpeg({
  videoId,
  tabId,
  data,
  sourceExtension,
  filenameOutput,
  outputExtension,
  metadata
}: {
  videoId: string;
  tabId: number;
  data: Uint8Array;
  sourceExtension: string;
  filenameOutput: string;
  outputExtension: string;
  metadata?: VideoMetadata | null;
}) {
  if (metadata?.isMusic) {
    await reportProgress({
      videoId,
      progress: 0,
      progressType: ProgressType.FFmpeg,
      tabId
    });
    return runEmbedMetadata(videoId, {
      audioData: toOwnedArrayBuffer(data),
      filenameOutput,
      sourceExtension,
      metadata,
      thumbnailUrl: metadata.thumbnailUrl,
      videoId,
      tabId
    });
  }

  if (outputExtension === "flac") {
    await reportProgress({
      videoId,
      progress: 0,
      progressType: ProgressType.FFmpeg,
      tabId
    });
    return runTranscodeAudio(videoId, {
      audioData: toOwnedArrayBuffer(data),
      sourceExtension,
      filenameOutput,
      videoId,
      tabId
    });
  }

  return data;
}
