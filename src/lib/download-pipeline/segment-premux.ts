import { getFFmpeg } from "./ffmpeg-instance";
import { closeFmp4AudioGaps } from "./fmp4-close-gaps";
import { parseFmp4VideoStartSec, parseFmp4KeyframeAtOrAfterSec } from "./fmp4-video-start";
import { parseWebmAudioStartSec } from "./webm-audio-start";
import { stripWebmDtxClusters } from "./webm-strip-dtx";

function countFmp4Fragments(data: Uint8Array): number {
  let count = 0;
  for (let i = 0; i <= data.byteLength - 8; i++) {
    if (data[i + 4] === 0x6D && data[i + 5] === 0x6F && data[i + 6] === 0x6F && data[i + 7] === 0x66) {
      count++;
      i += 7;
    }
  }
  return count;
}

function countWebmFragments(data: Uint8Array): number {
  let count = 0;
  for (let i = 0; i <= data.byteLength - 4; i++) {
    if (data[i] === 0x1A && data[i + 1] === 0x45 && data[i + 2] === 0xDF && data[i + 3] === 0xA3) {
      count++;
    }
  }
  return count || 1;
}

export async function muxSingleSegment({
  seg, step, videoExt, targetExt, audioExt, isOpusAudio: _isOpusAudio, writtenPaths, logEvent, overrideTrimSec
}: {
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
}) {
  const ffmpeg = getFFmpeg();
  const vFile = `tmp_vseg_${seg.index}.${videoExt}`;
  const aFile = `tmp_aseg_${seg.index}.${audioExt}`;

  const videoFragments = countFmp4Fragments(seg.video);
  const audioFragments = countWebmFragments(seg.audio);
  const videoStartSec = parseFmp4VideoStartSec(seg.video) ?? parseWebmAudioStartSec(seg.video);
  const audioStartSec = parseWebmAudioStartSec(seg.audio) ?? parseFmp4VideoStartSec(seg.audio);
  const audioSkipSec = videoStartSec !== undefined && audioStartSec !== undefined
    ? Math.max(0, videoStartSec - audioStartSec)
    : 0;
  // When audio buffer starts AFTER the video keyframe (aStart > vStart), seek the
  // video input to the first fmp4 keyframe at or after aStart, then trim audio
  // forward by (seekKeyframe - aStart) so both streams begin at the same content
  // position. The previous segment's trim is extended to seekKeyframe by
  // segment-filter.ts, so no content gap appears at the concat boundary.
  // Uses absolute PTS for -ss (FFmpeg requires absolute PTS before input).
  const videoSeekAbsSec = videoStartSec !== undefined && audioStartSec !== undefined
    && audioStartSec > videoStartSec
    ? parseFmp4KeyframeAtOrAfterSec(seg.video, audioStartSec)
    : undefined;
  // How far the effective video start shifts forward due to the seek.
  const seekDelta = videoSeekAbsSec !== undefined && videoStartSec !== undefined
    ? videoSeekAbsSec - videoStartSec
    : 0;
  // Extra audio to discard so audio content aligns with the post-seek video start.
  const audioSeekTrimSec = videoSeekAbsSec !== undefined && audioStartSec !== undefined
    ? Math.max(0, videoSeekAbsSec - audioStartSec)
    : 0;

  const capturedDuration = seg.videoBufferEndSec !== undefined
    ? seg.videoBufferEndSec - (videoStartSec ?? seg.startSec) - seekDelta
    : step - seekDelta;
  const capturedTrimDuration = step > 0 ? Math.min(step, Math.max(capturedDuration, 0)) : 0;
  const trimDuration = overrideTrimSec !== undefined
    ? Math.max(0, overrideTrimSec - seekDelta)
    : capturedTrimDuration;

  const { data: strippedAudio } = stripWebmDtxClusters(
    seg.audio,
    videoStartSec !== undefined ? videoStartSec * 1000 : undefined
  );
  const processedAudio = closeFmp4AudioGaps(strippedAudio, logEvent);

  await Promise.all([
    ffmpeg.FS.writeFile(vFile, seg.video),
    ffmpeg.FS.writeFile(aFile, processedAudio)
  ]);
  writtenPaths.push(vFile, aFile);

  // audioSkipSec (vStart > aStart, no video seek): normalize audio PTS to 0-based
  // before trimming so the atrim threshold is relative, not absolute. Absolute PTS
  // in fMP4 audio may be shifted by closeFmp4AudioGaps, making direct absolute trim
  // unreliable. The final asetpts reset lands audio at PTS 0; avoid_negative_ts
  // make_zero then keeps it there (video is also near 0 with no -ss applied).
  //
  // audioSeekTrimSec (aStart > vStart, video seeked to videoSeekAbsSec): audio PTS
  // is absolute and unmodified in the range we care about (fMP4 gap-closing only
  // shifts later sub-fragments). atrim=start=videoSeekAbsSec drops the pre-seek
  // window; avoid_negative_ts make_zero then shifts both video (at videoSeekAbsSec)
  // and audio (also at videoSeekAbsSec) by -videoSeekAbsSec → both land at 0.
  let audioFilter = "anull";
  if (audioSkipSec > 0) {
    audioFilter = `asetpts=PTS-STARTPTS,atrim=start=${audioSkipSec.toFixed(6)},asetpts=PTS-STARTPTS`;
  } else if (audioSeekTrimSec > 0) {
    audioFilter = `atrim=start=${videoSeekAbsSec!.toFixed(6)}`;
  }

  const segMuxArgs: string[] = ["-y"];
  if (videoSeekAbsSec !== undefined) {
    segMuxArgs.push("-ss", videoSeekAbsSec.toFixed(6));
  }

  segMuxArgs.push("-i", vFile, "-i", aFile, "-map", "0:v:0", "-map", "1:a:0", "-af", audioFilter);

  segMuxArgs.push("-c:v", "copy", "-c:a", "aac", "-avoid_negative_ts", "make_zero");

  if (trimDuration > 0) {
    segMuxArgs.push("-t", trimDuration.toFixed(3));
  }

  const segMuxFile = `tmp_seg_${seg.index}_muxed.${targetExt}`;
  segMuxArgs.push(segMuxFile);

  const dtxStripped = seg.audio.byteLength - strippedAudio.byteLength;
  const fmp4GapsClosed = processedAudio !== strippedAudio;
  let effectiveAudioTrimSec: number | undefined;
  if (audioSkipSec > 0) {
    effectiveAudioTrimSec = audioSkipSec;
  } else if (audioSeekTrimSec > 0) {
    effectiveAudioTrimSec = audioSeekTrimSec;
  }

  logEvent(`[ytdl:pipeline] seg ${seg.index} fragments video=${videoFragments} audio=${audioFragments} vStart=${videoStartSec?.toFixed(3) ?? "?"} aStart=${audioStartSec?.toFixed(3) ?? "?"} audioTrim=${effectiveAudioTrimSec?.toFixed(3) ?? "none"}s videoSeek=${videoSeekAbsSec?.toFixed(3) ?? "none"}s seekDelta=${seekDelta.toFixed(3)}s trim=${trimDuration.toFixed(3)}s dtxStripped=${dtxStripped}B fmp4Gaps=${fmp4GapsClosed} keyframeAligned=${overrideTrimSec !== undefined}`);

  const segMuxExit = await ffmpeg.exec(...segMuxArgs);
  if (segMuxExit !== 0) {
    logEvent(`[ytdl:pipeline] seg ${seg.index} mux failed (exit ${segMuxExit}); skipping`);
    return null;
  }

  writtenPaths.push(segMuxFile);
  return segMuxFile;
}
