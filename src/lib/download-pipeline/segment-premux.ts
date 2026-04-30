import { getFFmpeg } from "./ffmpeg-instance";
import { parseFmp4VideoStartSec } from "./fmp4-video-start";

export function muxSingleSegment({
  ffmpeg, seg, step, videoExt, targetExt, audioExt, isOpusAudio, writtenPaths, logEvent, overrideTrimSec
}: {
  ffmpeg: ReturnType<typeof getFFmpeg>;
  seg: {
    index: number;
    video: Uint8Array;
    audio: Uint8Array;
    startSec: number;
    videoBufferEndSec?: number;
  };
  step: number;
  videoExt: string;
  targetExt: string;
  audioExt: string;
  isOpusAudio: boolean;
  writtenPaths: string[];
  logEvent: (msg: string) => void;
  overrideTrimSec?: number;
}): string | null {
  const vFile = `tmp_vseg_${seg.index}.${videoExt}`;
  const aFile = `tmp_aseg_${seg.index}.${audioExt}`;
  ffmpeg.FS.writeFile(vFile, seg.video);
  ffmpeg.FS.writeFile(aFile, seg.audio);
  writtenPaths.push(vFile, aFile);

  const videoHex = Array.from(seg.video.subarray(0, 16)).map(byte => byte.toString(16).padStart(2, "0")).join(" ");
  const audioHex = Array.from(seg.audio.subarray(0, 16)).map(byte => byte.toString(16).padStart(2, "0")).join(" ");
  logEvent(`[ytdl:pipeline] seg ${seg.index} video[0..16]=${videoHex} audio[0..16]=${audioHex}`);
  const videoStartSec = parseFmp4VideoStartSec(seg.video);
  const preroll = videoStartSec !== undefined
    ? Math.max(0, seg.startSec - videoStartSec)
    : 0;

  const segMuxArgs: string[] = [
    "-y", "-i", vFile, "-i", aFile, "-map", "0:v:0", "-map", "1:a:0",
    "-c:v", "copy", "-c:a", isOpusAudio ? "aac" : "copy"
  ];
  if (isOpusAudio) {
    segMuxArgs.push("-af", "aresample=async=100000");
  }

  segMuxArgs.push("-avoid_negative_ts", "make_zero");

  // Use keyframe-aligned trim if provided (from muxValidSegments), otherwise
  // fall back to buffered duration. Trimming each segment to the NEXT segment's
  // keyframe position prevents the backward-jump artifact at boundaries: the
  // preroll frames (video earlier than audio start) are no longer duplicated
  // across segment boundaries in the final concat.
  const capturedDuration = seg.videoBufferEndSec !== undefined
    ? seg.videoBufferEndSec - (videoStartSec ?? seg.startSec)
    : step;
  const trimDuration = overrideTrimSec ?? (step > 0 ? Math.min(step, Math.max(capturedDuration, 0)) : 0);
  if (trimDuration > 0) {
    segMuxArgs.push("-t", trimDuration.toFixed(3));
  }

  // Use the same container as the final output: MP4 for AV1 (avoids
  // AV1-in-MKV codec-config transfer edge cases in older ffmpeg.wasm),
  // MKV for VP9/WebM.
  const segMuxFile = `tmp_seg_${seg.index}_muxed.${targetExt}`;
  segMuxArgs.push(segMuxFile);

  logEvent(`[ytdl:pipeline] seg ${seg.index} pre-mux videoStart=${videoStartSec?.toFixed(3) ?? "?"} preroll=${preroll.toFixed(3)}s trim=${trimDuration.toFixed(3)}s keyframeAligned=${overrideTrimSec !== undefined} bufEnd=${seg.videoBufferEndSec?.toFixed(1) ?? "?"}`);

  const segMuxExit = ffmpeg.exec(...segMuxArgs);
  if (segMuxExit !== 0) {
    logEvent(`[ytdl:pipeline] seg ${seg.index} pre-mux failed (exit ${segMuxExit}); skipping`);
    return null;
  }

  writtenPaths.push(segMuxFile);
  return segMuxFile;
}
