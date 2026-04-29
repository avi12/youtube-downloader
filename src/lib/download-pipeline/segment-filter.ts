import { getFFmpeg } from "./ffmpeg-instance";
import { muxSingleSegment } from "./segment-premux";
import type { ProcessStreamData } from "@/types";

export type ValidSegment = {
  index: number;
  video: Uint8Array;
  audio: Uint8Array;
  startSec: number;
};

export function buildValidSegments(
  segments: NonNullable<ProcessStreamData["segments"]>,
  step: number,
  logEvent: (msg: string) => void
): ValidSegment[] {
  const validSegments: ValidSegment[] = [];
  for (const [index, segment] of segments.entries()) {
    if (!segment || segment.video.byteLength === 0 || segment.audio.byteLength === 0) {
      logEvent(`[ytdl:pipeline] segment ${index} skipped (empty)`);
      continue;
    }

    const startSec = index * step;
    logEvent(`[ytdl:pipeline] segment ${index} startSec=${startSec} video=${segment.video.byteLength}B audio=${segment.audio.byteLength}B`);
    validSegments.push({
      index,
      video: segment.video,
      audio: segment.audio,
      startSec
    });
  }

  return validSegments;
}

export function muxValidSegments({
  ffmpeg, validSegments, step, videoExt, targetExt, audioExt, isOpusAudio, writtenPaths, logEvent
}: {
  ffmpeg: ReturnType<typeof getFFmpeg>;
  validSegments: ValidSegment[];
  step: number;
  videoExt: string;
  targetExt: string;
  audioExt: string;
  isOpusAudio: boolean;
  writtenPaths: string[];
  logEvent: (msg: string) => void;
}): string[] {
  // Per-segment pre-mux: mux each segment's video + audio together before
  // global concat so A/V timestamps are aligned within every segment.
  //
  // Root cause of desync: SABR video snaps to the nearest keyframe before the
  // seek target. The captured video stream therefore starts a few seconds
  // earlier than the audio stream (which starts at exactly startSec).
  // video.buffered.start(0) is not usable here — per MSE spec it returns the
  // intersection of all SourceBuffers, which equals the audio start (startSec),
  // masking the video preroll entirely.
  //
  // Fix: parse baseMediaDecodeTime / timescale from the raw fMP4 bytes to get
  // the true video start. Apply -itsoffset {preroll} to the video input only
  // (-itsoffset applies to the immediately following -i, not all subsequent
  // inputs) so video first_pts shifts forward to match audio first_pts.
  // -avoid_negative_ts make_zero then remaps both to t=0. The global concat
  // of already-aligned segments produces a clean, in-sync output.
  const muxedSegFiles: string[] = [];
  for (const seg of validSegments) {
    const muxedFile = muxSingleSegment({
      ffmpeg,
      seg,
      step,
      videoExt,
      targetExt,
      audioExt,
      isOpusAudio,
      writtenPaths,
      logEvent
    });
    if (muxedFile) {
      muxedSegFiles.push(muxedFile);
    }
  }

  return muxedSegFiles;
}
