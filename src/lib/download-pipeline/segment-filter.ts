import { getFFmpeg } from "./ffmpeg-instance";
import { parseFmp4VideoStartSec } from "./fmp4-video-start";
import { muxSingleSegment } from "./segment-premux";
import type { ProcessStreamData } from "@/types";

export type ValidSegment = {
  index: number;
  video: Uint8Array;
  audio: Uint8Array;
  startSec: number;
  videoBufferEndSec?: number;
};

export function buildValidSegments(
  segments: NonNullable<ProcessStreamData["segments"]>,
  step: number,
  logEvent: (msg: string) => void
) {
  const validSegments: ValidSegment[] = [];
  for (const [iSegment, segment] of segments.entries()) {
    if (!segment || segment.video.byteLength === 0 || segment.audio.byteLength === 0) {
      logEvent(`[ytdl:pipeline] segment ${iSegment} skipped (empty)`);
      continue;
    }

    const startSec = iSegment * step;
    logEvent(`[ytdl:pipeline] segment ${iSegment} startSec=${startSec} video=${segment.video.byteLength}B audio=${segment.audio.byteLength}B bufEnd=${segment.videoBufferEndSec?.toFixed(1) ?? "?"}`);
    validSegments.push({
      index: iSegment,
      video: segment.video,
      audio: segment.audio,
      startSec,
      videoBufferEndSec: segment.videoBufferEndSec
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
}) {
  // Pre-compute the true video start time (keyframe position) for every segment.
  // SABR snaps video to the nearest keyframe before the seek target, so each
  // segment's video starts a few seconds before startSec. -avoid_negative_ts
  // make_zero then shifts timestamps so each segment's video/audio start at t=0.
  //
  // Trim each segment to end exactly at the NEXT segment's keyframe, not at the
  // step boundary. This eliminates the "backward jump" artifact at boundaries:
  // without this trim, the concat would play SABR 31.9-35s content twice at the
  // 35s mark (once from seg0, once as seg1's preroll), while audio continued
  // forward. The result appeared as a stuck/repeated frame every 35 seconds.
  const videoStarts = validSegments.map(seg => parseFmp4VideoStartSec(seg.video));

  const keyframeTrimSecs = validSegments.map((seg, i) => {
    const thisStart = videoStarts[i];
    const nextStart = videoStarts[i + 1];
    if (thisStart !== undefined && nextStart !== undefined) {
      const capturedEnd = seg.videoBufferEndSec ?? (seg.startSec + step);
      return Math.min(nextStart - thisStart, capturedEnd - thisStart);
    }

    return undefined;
  });

  const muxedSegFiles: string[] = [];
  for (const [i, seg] of validSegments.entries()) {
    const muxedFile = muxSingleSegment({
      ffmpeg,
      seg,
      step,
      videoExt,
      targetExt,
      audioExt,
      isOpusAudio,
      writtenPaths,
      logEvent,
      overrideTrimSec: keyframeTrimSecs[i]
    });
    if (muxedFile) {
      muxedSegFiles.push(muxedFile);
    }
  }

  return muxedSegFiles;
}
