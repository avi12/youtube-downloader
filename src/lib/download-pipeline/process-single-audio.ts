import { reportProgress } from ".";
import { enqueueMuxJob, progressHandlers } from "./ffmpeg-instance";
import { embedMusicMetadata } from "./music-metadata";
import { transcodeAudio } from "./transcode-audio";
import { ProgressType } from "@/types";
import type { VideoMetadata } from "@/types";

const FFMPEG_PROGRESS_CAP = 0.99;

export async function processAudioWithFfmpeg({
  videoId,
  tabId,
  data,
  filenameOutput,
  sourceExtension,
  metadata,
  isFlacTarget
}: {
  videoId: string;
  tabId: number;
  data: Uint8Array;
  filenameOutput: string;
  sourceExtension: string;
  metadata?: VideoMetadata | null;
  isFlacTarget: boolean;
}) {
  function handleProgress({ progress }: { progress: number }) {
    void reportProgress({
      videoId,
      progress: Math.min(progress, FFMPEG_PROGRESS_CAP),
      progressType: ProgressType.FFmpeg,
      tabId
    });
  }

  if (metadata?.isMusic) {
    progressHandlers.add(handleProgress);
    try {
      await enqueueMuxJob(async () => {
        data = await embedMusicMetadata({
          audioData: data,
          filenameOutput,
          sourceExtension,
          metadata
        });
      });
    } finally {
      progressHandlers.delete(handleProgress);
    }

    return data;
  }

  if (isFlacTarget) {
    progressHandlers.add(handleProgress);
    try {
      await enqueueMuxJob(async () => {
        data = await transcodeAudio({
          audioData: data,
          sourceExtension,
          filenameOutput
        });
      });
    } finally {
      progressHandlers.delete(handleProgress);
    }
  }

  return data;
}
