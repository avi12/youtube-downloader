import { reportProgress } from ".";
import { getFFmpeg, progressHandlers, tryUnlink } from "./ffmpeg-instance";
import { concatSegments } from "./segment-concat";
import { buildValidSegments, muxValidSegments } from "./segment-filter";
import { broadcastDebugLogToYouTubeTabs } from "@/lib/messaging/debug-log";
import { ProgressType } from "@/types";
import type { ProcessStreamData } from "@/types";

function logPipelineEvent(message: string) {
  void broadcastDebugLogToYouTubeTabs(message);
}

const DEFAULT_MULTIPART_EXT = "mkv";

export async function processMultipartSegments(item: ProcessStreamData & { segments: NonNullable<ProcessStreamData["segments"]> }) {
  const { videoId, videoMimeType, audioMimeType, tabId, segments, segmentDurationSec } = item;
  const ffmpeg = getFFmpeg();

  const videoExt = videoMimeType.includes("av01") || !videoMimeType.includes("webm") ? "mp4" : "webm";
  const targetExt = videoExt === "mp4" ? "mp4" : DEFAULT_MULTIPART_EXT;
  const audioExt = audioMimeType.includes("webm") ? "webm" : "m4a";
  // Opus audio in an MP4 container is not supported by most decoders (Windows
  // Media Player, QuickTime, etc.) - transcode to AAC in each per-segment mux.
  const isOpusAudio = audioExt === "webm" && targetExt === "mp4";
  logPipelineEvent(`[ytdl:pipeline] mimeTypes: video=${videoMimeType} audio=${audioMimeType} videoExt=${videoExt} audioExt=${audioExt}`);

  function handleFFmpegProgress({ progress }: { progress: number }) {
    void reportProgress({
      videoId,
      progress: Math.min(progress, 0.99),
      progressType: ProgressType.FFmpeg,
      tabId
    });
  }

  progressHandlers.add(handleFFmpegProgress);
  const writtenPaths: string[] = [];

  try {
    const step = segmentDurationSec ?? 0;
    const validSegments = buildValidSegments(segments, step, logPipelineEvent);
    if (validSegments.length === 0) {
      throw new Error("All segments empty; nothing to concat");
    }

    const muxedSegFiles = muxValidSegments({
      ffmpeg,
      validSegments,
      step,
      videoExt,
      targetExt,
      audioExt,
      isOpusAudio,
      writtenPaths,
      logEvent: logPipelineEvent
    });
    if (muxedSegFiles.length === 0) {
      throw new Error("All segment pre-muxes failed; nothing to concat");
    }

    await concatSegments({
      ffmpeg,
      muxedSegFiles,
      targetExt,
      writtenPaths,
      logEvent: logPipelineEvent,
      item
    });
  } finally {
    progressHandlers.delete(handleFFmpegProgress);
    for (const path of writtenPaths) {
      tryUnlink({
        ffmpeg,
        filename: path
      });
    }
  }
}
