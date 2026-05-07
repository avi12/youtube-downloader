import { parseFmp4VideoStartSec, parseFmp4KeyframeAtOrAfterSec } from "./fmp4-video-start";
import { muxSingleSegment } from "./segment-premux";
import { parseWebmAudioStartSec } from "./webm-audio-start";
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
    // A segment whose buffer ended before its target start was captured from the
    // wrong position (SABR iframe loaded from t=0 instead of the seek target).
    // Including it would insert content from early in the video at the wrong
    // timeline position, producing a gap + wrong-content block in the output.
    if (startSec > 0 && segment.videoBufferEndSec !== undefined && segment.videoBufferEndSec < startSec) {
      logEvent(`[ytdl:pipeline] segment ${iSegment} skipped (wrong position: bufEnd=${segment.videoBufferEndSec.toFixed(1)} < startSec=${startSec})`);
      continue;
    }

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

export async function muxValidSegments({
  validSegments, step, videoExt, targetExt, audioExt, isOpusAudio, writtenPaths, logEvent
}: {
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
  // Trim each segment to end exactly at the NEXT segment's effective content
  // start, not at the step boundary. This eliminates the "backward jump" artifact
  // at boundaries: without this trim, the concat would play SABR 31.9-35s content
  // twice at the 35s mark (once from seg0, once as seg1's preroll), while audio
  // continued forward. The result appeared as a stuck/repeated frame every 35s.
  //
  // When the next segment's audio starts AFTER its video keyframe (SABR always
  // starts at 10s boundaries), segment-premux applies an input-side -ss seek on
  // the video to align both streams to aStart. Use aStart as the trim boundary
  // for the current segment so it covers the gap, avoiding a content hole at the
  // concat boundary.
  const videoStarts = validSegments.map(seg => parseFmp4VideoStartSec(seg.video) ?? parseWebmAudioStartSec(seg.video));
  const audioStarts = validSegments.map(seg => parseWebmAudioStartSec(seg.audio) ?? parseFmp4VideoStartSec(seg.audio));

  // For segments where aStart > vStart, the premux seeks the video input to the
  // first keyframe at or after aStart, then trims audio by (seekKeyframe - aStart)
  // so both streams start at the same content position. The previous segment must
  // extend its trim to seekKeyframe (not just vStart) to cover that range.
  const effectiveSeekKeyframes = validSegments.map((seg, i) => {
    const vStart = videoStarts[i];
    const aStart = audioStarts[i];
    if (vStart === undefined || aStart === undefined || aStart <= vStart) {
      return undefined;
    }

    return parseFmp4KeyframeAtOrAfterSec(seg.video, aStart);
  });

  const keyframeTrimSecs = validSegments.map((seg, i) => {
    const thisStart = videoStarts[i];
    if (thisStart === undefined) {
      return undefined;
    }

    const capturedEnd = seg.videoBufferEndSec ?? (seg.startSec + step);
    // Use the next segment's seek keyframe as the trim boundary when it exists.
    // This ensures the current segment covers the content up to where the next
    // segment will begin after its input-side seek, leaving no gap.
    const nextEffectiveStart = effectiveSeekKeyframes[i + 1] ?? videoStarts[i + 1];
    if (nextEffectiveStart !== undefined && nextEffectiveStart > thisStart) {
      return Math.min(nextEffectiveStart - thisStart, capturedEnd - thisStart);
    }

    return capturedEnd - thisStart;
  });

  const muxedSegFiles: string[] = [];
  for (const [i, seg] of validSegments.entries()) {
    const muxedFile = await muxSingleSegment({
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
