import { toUint8Array, triggerDownload, reportProgress } from ".";
import { getFFmpeg, progressHandlers, tryUnlink } from "./ffmpeg-instance";
import { broadcastDebugLogToYouTubeTabs } from "@/lib/messaging/debug-log";
import { ProgressType } from "@/types";
import type { ProcessStreamData } from "@/types";

function logPipelineEvent(message: string) {
  void broadcastDebugLogToYouTubeTabs(message);
}

// Pipeline for multipart (scrub) downloads.
//
// Each scrub segment is captured from a fresh per-iframe SABR session, so
// tfdt base_decode_time is session-relative (resets to ~0 for each iframe),
// not absolute from video start. Raw binary concat produces non-monotonous
// DTS and FFmpeg collapses every segment past the first into a tiny window.
//
// Algorithm:
//   1. Parse the timescale from the first segment's moov box.
//   2. For each segment at original index N with step S:
//      a. Read first moof's tfdt DTS (firstDts).
//      b. Compute dtsOffset = N * S * timescale - firstDts.
//      c. Copy each moof, rewrite all tfdt base_decode_times by +dtsOffset.
//      d. Skip moofs whose adjusted DTS >= (N+1)*S*timescale (clip at segment
//         boundary to eliminate pre-seek keyframe overlap with the next segment).
//      e. The last segment has no upper clip.
//   3. Binary-concat: init from first segment, then the adjusted moof+mdat pairs.
//   4. Single FFmpeg stream-copy merge: -i video -i audio -c copy output.
const DEFAULT_MULTIPART_EXT = "mkv";
const DEFAULT_TIMESCALE = 90000;

function parseFmp4Boxes(data: Uint8Array): Array<{
  type: string;
  start: number;
  size: number;
}> {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const boxes: Array<{
    type: string;
    start: number;
    size: number;
  }> = [];
  let offset = 0;
  while (offset + 8 <= data.byteLength) {
    let size = view.getUint32(offset);
    const type = String.fromCharCode(
      data[offset + 4]!, data[offset + 5]!, data[offset + 6]!, data[offset + 7]!
    );
    const headerSize = size === 1 ? 16 : 8;
    if (size === 1) {
      if (offset + 16 > data.byteLength) {
        break;
      }

      size = view.getUint32(offset + 8) * 2 ** 32 + view.getUint32(offset + 12);
    }

    if (size < headerSize) {
      break;
    }

    boxes.push({
      type,
      start: offset,
      size
    });
    offset += size;
  }

  return boxes;
}

// Reads tfdt base_decode_time at relOffset within data.
// relOffset is the start of the tfdt box (including its 8-byte size+type header).
function readTfdtDts(data: Uint8Array, relOffset: number): bigint {
  const view = new DataView(data.buffer, data.byteOffset);
  const version = data[relOffset + 8]!;
  if (version === 1) {
    return (BigInt(view.getUint32(relOffset + 12)) << 32n) | BigInt(view.getUint32(relOffset + 16));
  }

  return BigInt(view.getUint32(relOffset + 12));
}

function parseMoovTimescale(data: Uint8Array): number {
  for (const moovBox of parseFmp4Boxes(data)) {
    if (moovBox.type !== "moov") {
      continue;
    }

    const moovInner = data.subarray(moovBox.start + 8, moovBox.start + moovBox.size);
    for (const trakBox of parseFmp4Boxes(moovInner)) {
      if (trakBox.type !== "trak") {
        continue;
      }

      const trakInner = moovInner.subarray(trakBox.start + 8, trakBox.start + trakBox.size);
      for (const mdiaBox of parseFmp4Boxes(trakInner)) {
        if (mdiaBox.type !== "mdia") {
          continue;
        }

        const mdiaInner = trakInner.subarray(mdiaBox.start + 8, mdiaBox.start + mdiaBox.size);
        for (const mdhdBox of parseFmp4Boxes(mdiaInner)) {
          if (mdhdBox.type !== "mdhd") {
            continue;
          }

          // mdhd: size(4) + type(4) + version(1) + flags(3) + creation_time + modification_time + timescale(4)
          // version 0: creation_time(4) + modification_time(4) → timescale at offset 20
          // version 1: creation_time(8) + modification_time(8) → timescale at offset 28
          const version = mdiaInner[mdhdBox.start + 8]!;
          const timescaleOff = mdhdBox.start + (version === 1 ? 28 : 20);
          const view = new DataView(mdiaInner.buffer, mdiaInner.byteOffset);
          const timescale = view.getUint32(timescaleOff);
          if (timescale > 0) {
            return timescale;
          }
        }
      }
    }
  }

  return DEFAULT_TIMESCALE;
}

// Rewrites the first tfdt base_decode_time in moofFull by adding dtsOffset.
// Returns a copy of moofFull with the patched tfdt.
function patchMoofTfdt(moofFull: Uint8Array, dtsOffset: bigint): Uint8Array {
  const out = moofFull.slice();
  const moofInner = out.subarray(8);
  for (const trafBox of parseFmp4Boxes(moofInner)) {
    if (trafBox.type !== "traf") {
      continue;
    }

    const trafInner = moofInner.subarray(trafBox.start + 8, trafBox.start + trafBox.size);
    for (const tfdtBox of parseFmp4Boxes(trafInner)) {
      if (tfdtBox.type !== "tfdt") {
        continue;
      }

      const oldDts = readTfdtDts(trafInner, tfdtBox.start);
      const newDts = oldDts + dtsOffset;
      const view = new DataView(trafInner.buffer, trafInner.byteOffset);
      const version = trafInner[tfdtBox.start + 8]!;
      if (version === 1) {
        view.setUint32(tfdtBox.start + 12, Number(newDts >> 32n));
        view.setUint32(tfdtBox.start + 16, Number(newDts & 0xFFFFFFFFn));
      } else {
        view.setUint32(tfdtBox.start + 12, Number(newDts & 0xFFFFFFFFn));
      }

      return out;
    }
  }

  return out;
}

// Concatenates fMP4 segments with per-segment DTS offset correction.
// stepSec and segIndices enable DTS stitching for per-iframe SABR captures
// where each segment's DTS resets to near-zero (session-relative).
// Falls back to raw byte concatenation if no fMP4 init section is found.
function concatenateFmp4Segments(
  segments: Uint8Array[],
  stepSec?: number,
  segIndices?: number[]
): Uint8Array {
  const INIT_BOX_TYPES = new Set(["ftyp", "moov", "free", "skip"]);
  const firstData = segments[0]!;

  const initParts: Uint8Array[] = [];
  for (const { type, start, size } of parseFmp4Boxes(firstData)) {
    if (INIT_BOX_TYPES.has(type)) {
      initParts.push(firstData.subarray(start, start + size));
    }
  }

  if (initParts.length === 0) {
    const totalSize = segments.reduce((acc, seg) => acc + seg.byteLength, 0);
    const combined = new Uint8Array(totalSize);
    let rawOffset = 0;
    for (const seg of segments) {
      combined.set(seg, rawOffset);
      rawOffset += seg.byteLength;
    }

    return combined;
  }

  const isDtsMode = stepSec !== undefined && stepSec > 0 && segIndices !== undefined;
  const timescale = isDtsMode ? parseMoovTimescale(firstData) : DEFAULT_TIMESCALE;
  if (isDtsMode) {
    logPipelineEvent(`[ytdl:pipeline] concatenate: timescale=${timescale} stepSec=${stepSec} segments=${segments.length}`);
  }

  // Collect all moof+mdat pairs across all segments, apply per-segment boundary
  // clips, then sort globally and dedup.
  // Right clip (non-last segments): removes keyframe pre-roll that overlaps
  // with the next segment's range.
  // Left clip (last segment only): removes contaminating late-arriving chunks
  // from the previous iframe that leaked into the last segment's binary. The
  // previous segment's right-clip already supplies those pre-roll keyframes, so
  // this does not create a gap.
  const allPairs: Array<{
    adjustedDts: bigint;
    moof: Uint8Array;
    mdat: Uint8Array;
  }> = [];

  for (let arrayIndex = 0; arrayIndex < segments.length; arrayIndex++) {
    const data = segments[arrayIndex]!;
    const segIndex = segIndices?.[arrayIndex] ?? arrayIndex;
    const isLastSeg = arrayIndex === segments.length - 1;

    let minAdjustedDts: bigint | null = null;
    let maxAdjustedDts: bigint | null = null;
    if (isDtsMode) {
      if (isLastSeg && segIndex > 0) {
        minAdjustedDts = BigInt(Math.round(segIndex * stepSec * timescale));
      }

      if (!isLastSeg) {
        maxAdjustedDts = BigInt(Math.round((segIndex + 1) * stepSec * timescale));
      }
    }

    // Find first moof DTS so we can compute per-segment offset.
    // SABR DTS is session-relative (resets to ~0 per iframe) for most segments
    // but absolute for some (e.g. the first two and those past the rate-limit
    // window). Distinguish by comparing firstRawDts against one step-worth of
    // DTS: if it exceeds that threshold the segment already has correct absolute
    // DTS and needs no shift — the left-clip boundary handles pre-roll removal.
    let firstRawDts = 0n;
    if (isDtsMode) {
      for (const { type, start, size } of parseFmp4Boxes(data)) {
        if (type === "moof") {
          firstRawDts = getFirstMoofDts(data.subarray(start, start + size)) ?? 0n;
          break;
        }
      }
    }

    const oneStepDts = isDtsMode ? BigInt(Math.round(stepSec! * timescale)) : 0n;
    const isAbsoluteDts = firstRawDts > oneStepDts;
    const dtsOffset = isDtsMode && !isAbsoluteDts
      ? BigInt(Math.round(segIndex * stepSec * timescale)) - firstRawDts
      : 0n;

    let pendingMoof: {
      raw: Uint8Array;
      adjustedDts: bigint;
    } | null = null;
    let moofCount = 0;
    let leftClippedCount = 0;
    let rightClippedCount = 0;
    let minAcceptedDts: bigint | null = null;
    let maxAcceptedDts: bigint | null = null;

    for (const { type, start, size } of parseFmp4Boxes(data)) {
      if (type === "moof") {
        const rawMoof = data.subarray(start, start + size);
        const rawDts = getFirstMoofDts(rawMoof) ?? 0n;
        const adjustedDts = rawDts + dtsOffset;
        if (isDtsMode && minAdjustedDts !== null && adjustedDts < minAdjustedDts) {
          leftClippedCount++;
          pendingMoof = null;
          continue;
        }

        if (isDtsMode && maxAdjustedDts !== null && adjustedDts >= maxAdjustedDts) {
          rightClippedCount++;
          pendingMoof = null;
          continue;
        }

        moofCount++;

        if (minAcceptedDts === null || adjustedDts < minAcceptedDts) {
          minAcceptedDts = adjustedDts;
        }

        if (maxAcceptedDts === null || adjustedDts > maxAcceptedDts) {
          maxAcceptedDts = adjustedDts;
        }

        pendingMoof = {
          raw: rawMoof,
          adjustedDts
        };
      } else if (type === "mdat") {
        if (pendingMoof !== null) {
          allPairs.push({
            adjustedDts: pendingMoof.adjustedDts,
            moof: dtsOffset !== 0n ? patchMoofTfdt(pendingMoof.raw, dtsOffset) : pendingMoof.raw,
            mdat: data.subarray(start, start + size)
          });
        }

        pendingMoof = null;
      }
    }

    if (isDtsMode) {
      logPipelineEvent(`[ytdl:pipeline] seg[${segIndex}] dtsMode=${isAbsoluteDts ? "absolute" : "session-rel"} firstRawDts=${firstRawDts} dtsOffset=${dtsOffset} collected=${moofCount} leftClip=${leftClippedCount} rightClip=${rightClippedCount} dtsRange=[${minAcceptedDts ?? "n/a"},${maxAcceptedDts ?? "n/a"}]`);
    }
  }

  // Global sort then strict-monotonic dedup: guarantees non-decreasing DTS in
  // the output regardless of contamination or per-segment ordering issues.
  allPairs.sort((left, right) => {
    if (left.adjustedDts < right.adjustedDts) {
      return -1;
    }

    return left.adjustedDts > right.adjustedDts ? 1 : 0;
  });

  // Dedup: skip any moof whose start DTS falls within the sample range of the
  // previously emitted moof. Two moofs can have overlapping DTS ranges when
  // the SABR server delivers a large chunk (e.g. 7 s) followed by a smaller
  // overlapping chunk from the same session (e.g. 2 s starting 0.04 s later).
  // Checking only base_decode_time equality is not enough; we need to compare
  // against the end DTS of the last emitted moof.
  const parts: Uint8Array[] = [...initParts];
  let prevEmittedEndDts = 0n;
  let dedupCount = 0;

  for (const { adjustedDts, moof, mdat } of allPairs) {
    if (adjustedDts < prevEmittedEndDts) {
      dedupCount++;
      continue;
    }

    parts.push(moof);
    parts.push(mdat);
    const moofDuration = getMoofTotalDuration(moof);
    if (isDtsMode && moofDuration === 0n) {
      logPipelineEvent(`[ytdl:pipeline] WARN getMoofTotalDuration=0 at dts=${adjustedDts}`);
    }

    prevEmittedEndDts = adjustedDts + moofDuration;
  }

  if (isDtsMode) {
    logPipelineEvent(`[ytdl:pipeline] global sort done: total=${allPairs.length} deduped=${dedupCount} emitted=${allPairs.length - dedupCount}`);
  }

  const totalSize = parts.reduce((acc, part) => acc + part.byteLength, 0);
  const combined = new Uint8Array(totalSize);
  let pos = 0;
  for (const part of parts) {
    combined.set(part, pos);
    pos += part.byteLength;
  }

  return combined;
}

// Returns the sum of all sample durations in the first trun of moofFull.
// Used so the dedup can skip moofs whose start DTS falls within an already-emitted moof's range.
function getMoofTotalDuration(moofFull: Uint8Array): bigint {
  const moofInner = moofFull.subarray(8);
  for (const trafBox of parseFmp4Boxes(moofInner)) {
    if (trafBox.type !== "traf") {
      continue;
    }

    const trafInner = moofInner.subarray(trafBox.start + 8, trafBox.start + trafBox.size);
    let defaultSampleDuration = 0;

    for (const box of parseFmp4Boxes(trafInner)) {
      if (box.type === "tfhd") {
        const tfhdView = new DataView(trafInner.buffer, trafInner.byteOffset);
        const tfhdFlags = tfhdView.getUint32(box.start + 8) & 0xFFFFFF;
        if (tfhdFlags & 0x000008) {
          let tfhdOffset = box.start + 16;
          if (tfhdFlags & 0x000001) {
            tfhdOffset += 8;
          }

          if (tfhdFlags & 0x000002) {
            tfhdOffset += 4;
          }

          defaultSampleDuration = tfhdView.getUint32(tfhdOffset);
        }
      }
    }

    for (const trunBox of parseFmp4Boxes(trafInner)) {
      if (trunBox.type !== "trun") {
        continue;
      }

      const trunView = new DataView(trafInner.buffer, trafInner.byteOffset);
      const trunFlags = trunView.getUint32(trunBox.start + 8) & 0xFFFFFF;
      const sampleCount = trunView.getUint32(trunBox.start + 12);
      const sampleDurationPresent = (trunFlags & 0x100) !== 0;
      if (!sampleDurationPresent) {
        // Fall back to 960 (AAC-LD at 48kHz) when neither trun per-sample
        // durations nor tfhd default_sample_duration are present.
        const effectiveDuration = defaultSampleDuration > 0 ? defaultSampleDuration : 960;
        return BigInt(effectiveDuration * sampleCount);
      }

      let offset = trunBox.start + 16;
      if (trunFlags & 0x001) {
        offset += 4;
      }

      if (trunFlags & 0x004) {
        offset += 4;
      }

      const sampleEntrySize =
        4 + // sample_duration
        (trunFlags & 0x200 ? 4 : 0) + // sample_size
        (trunFlags & 0x400 ? 4 : 0) + // sample_flags
        (trunFlags & 0x800 ? 4 : 0);  // sample_composition_time_offset

      let totalDuration = 0n;
      for (let i = 0; i < sampleCount; i++) {
        totalDuration += BigInt(trunView.getUint32(offset));
        offset += sampleEntrySize;
      }

      return totalDuration;
    }
  }

  return 0n;
}

// Returns the first tfdt base_decode_time in moofFull (full moof box with header).
function getFirstMoofDts(moofFull: Uint8Array): bigint | null {
  const moofInner = moofFull.subarray(8);
  for (const trafBox of parseFmp4Boxes(moofInner)) {
    if (trafBox.type !== "traf") {
      continue;
    }

    const trafInner = moofInner.subarray(trafBox.start + 8, trafBox.start + trafBox.size);
    for (const tfdtBox of parseFmp4Boxes(trafInner)) {
      if (tfdtBox.type !== "tfdt") {
        continue;
      }

      return readTfdtDts(trafInner, tfdtBox.start);
    }
  }

  return null;
}

export async function processMultipartSegments(item: ProcessStreamData & { segments: NonNullable<ProcessStreamData["segments"]> }) {
  const {
    videoId, filenameOutput, videoMimeType, audioMimeType, tabId, segments,
    additionalAudioStreams, subtitleStreams, primaryAudioLabel, segmentDurationSec
  } = item;
  const ffmpeg = getFFmpeg();

  function getVideoExt() {
    if (videoMimeType.includes("av01")) {
      return "mp4";
    }

    return videoMimeType.includes("webm") ? "webm" : "mp4";
  }

  const videoExt = getVideoExt();
  const targetExt = videoExt === "mp4" ? "mp4" : DEFAULT_MULTIPART_EXT;
  const audioExt = audioMimeType.includes("webm") ? "webm" : "m4a";
  logPipelineEvent(`[ytdl:pipeline] mimeTypes: video=${videoMimeType} audio=${audioMimeType} videoExt=${videoExt} audioExt=${audioExt}`);

  const filenameBase = filenameOutput.replace(/\.[^.]+$/, "");
  // FFmpeg misparses output filenames starting with "-" as unknown CLI flags.
  // Use safe tmp_ names for all FFmpeg FS operations; real filename only in triggerDownload.
  const combinedVideoName = `tmp_video.${videoExt}`;
  const combinedAudioName = `tmp_audio.${audioExt}`;
  const outputFfmpegName = `tmp_out.${targetExt}`;

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

    // Collect valid segments
    const validSegments: Array<{
      index: number;
      video: Uint8Array;
      audio: Uint8Array;
      startSec: number;
      videoBufferStartSec?: number;
    }> = [];

    for (const [index, segment] of segments.entries()) {
      if (!segment || segment.video.byteLength === 0 || segment.audio.byteLength === 0) {
        logPipelineEvent(`[ytdl:pipeline] segment ${index} skipped (empty)`);
        continue;
      }

      const startSec = index * step;
      logPipelineEvent(`[ytdl:pipeline] segment ${index} startSec=${startSec} video=${segment.video.byteLength}B audio=${segment.audio.byteLength}B`);
      validSegments.push({
        index,
        video: segment.video,
        audio: segment.audio,
        startSec,
        videoBufferStartSec: segment.videoBufferStartSec
      });
    }

    if (validSegments.length === 0) {
      throw new Error("All segments empty; nothing to concat");
    }

    // Drop the last segment if SABR delivered it from the wrong time range.
    // YouTube SABR is sequential — the last iframe at t=N may receive content
    // from t~=80 rather than t=N because the server continued from its last
    // position instead of seeking. Detect via videoBufferStartSec mismatch.
    if (validSegments.length > 1 && step > 0) {
      const lastSeg = validSegments[validSegments.length - 1]!;
      const bufStart = lastSeg.videoBufferStartSec;
      if (bufStart !== undefined && lastSeg.startSec - bufStart > step * 2) {
        logPipelineEvent(`[ytdl:pipeline] segment ${lastSeg.index} SABR misalign (bufferStart=${bufStart.toFixed(1)}, startSec=${lastSeg.startSec}); dropping`);
        validSegments.pop();
      }
    }

    const segIndices = validSegments.map(seg => seg.index);

    logPipelineEvent(`[ytdl:pipeline] stitching ${validSegments.length} video segments (step=${step}s)`);
    const combinedVideo = concatenateFmp4Segments(
      validSegments.map(seg => seg.video),
      step > 0 ? step : undefined,
      segIndices
    );
    logPipelineEvent(`[ytdl:pipeline] combined video size=${combinedVideo.byteLength}B`);
    ffmpeg.FS.writeFile(combinedVideoName, combinedVideo);
    writtenPaths.push(combinedVideoName);

    logPipelineEvent(`[ytdl:pipeline] stitching ${validSegments.length} audio segments (step=${step}s)`);

    // SABR delivers audio/webm MIME type but the actual binary may be fMP4
    // (ISOBMFF) rather than true WebM (EBML). Detect by checking the EBML
    // magic bytes; fall through to the fMP4 JS concat if not real WebM.
    const firstAudioBytes = validSegments[0]!.audio;
    const isActuallyWebm = firstAudioBytes.length >= 4 &&
      firstAudioBytes[0] === 0x1A && firstAudioBytes[1] === 0x45 &&
      firstAudioBytes[2] === 0xDF && firstAudioBytes[3] === 0xA3;
    logPipelineEvent(`[ytdl:pipeline] audio format detection: mimeExt=${audioExt} isEbml=${isActuallyWebm}`);

    if (audioExt === "webm" && step > 0 && isActuallyWebm) {
      // True WebM audio: use FFmpeg concat demuxer so each segment's cluster
      // timestamps are adjusted relative to the previous segment's duration.
      // Raw byte concat produces non-monotonic timestamps that cause FFmpeg to
      // discard all but the first and last few segments during the final mux.
      const audioSegFilenames: string[] = [];
      for (let i = 0; i < validSegments.length; i++) {
        const segFilename = `tmp_aseg_${segIndices[i]}.webm`;
        ffmpeg.FS.writeFile(segFilename, validSegments[i]!.audio);
        writtenPaths.push(segFilename);
        audioSegFilenames.push(segFilename);
      }

      const concatListName = `tmp_concat.txt`;
      const concatContent = audioSegFilenames.map((filename, i) => {
        const isLastSeg = i === audioSegFilenames.length - 1;
        return isLastSeg ? `file '${filename}'` : `file '${filename}'\nduration ${step}`;
      }).join("\n");
      ffmpeg.FS.writeFile(
        concatListName,
        new TextEncoder().encode(concatContent)
      );
      writtenPaths.push(concatListName);

      const concatExit = ffmpeg.exec(
        "-y", "-f", "concat", "-safe", "0", "-i", concatListName, "-c:a", "copy", combinedAudioName
      );
      logPipelineEvent(`[ytdl:pipeline] webm audio concat exit=${concatExit}`);

      if (concatExit !== 0) {
        throw new Error(`FFmpeg webm audio concat failed (exit ${concatExit})`);
      }
    } else {
      const combinedAudio = concatenateFmp4Segments(
        validSegments.map(seg => seg.audio),
        step > 0 ? step : undefined,
        segIndices
      );
      logPipelineEvent(`[ytdl:pipeline] combined audio size=${combinedAudio.byteLength}B`);
      ffmpeg.FS.writeFile(combinedAudioName, combinedAudio);
    }

    writtenPaths.push(combinedAudioName);

    // Mux: stream-copy merge
    const extraAudioWritten = additionalAudioStreams.filter(stream => Boolean(toUint8Array(stream.data)));
    const muxArgs: string[] = ["-y", "-i", combinedVideoName, "-i", combinedAudioName];
    const extraAudioInputs: {
      filename: string;
      label: string;
    }[] = [];
    const subtitleInputs: {
      filename: string;
      languageCode: string;
      label: string;
    }[] = [];

    for (const [iAudio, stream] of extraAudioWritten.entries()) {
      const data = toUint8Array(stream.data);
      if (!data) {
        continue;
      }

      const ext = stream.mimeType.includes("webm") ? "webm" : "m4a";
      const extraName = `tmp_extra_${iAudio}.${ext}`;
      ffmpeg.FS.writeFile(extraName, data);
      writtenPaths.push(extraName);
      muxArgs.push("-i", extraName);
      extraAudioInputs.push({
        filename: extraName,
        label: stream.label
      });
    }

    for (const [iSub, sub] of subtitleStreams.entries()) {
      const subName = `tmp_sub_${iSub}.srt`;
      ffmpeg.FS.writeFile(subName, new TextEncoder().encode(sub.srtContent));
      writtenPaths.push(subName);
      muxArgs.push("-i", subName);
      subtitleInputs.push({
        filename: subName,
        languageCode: sub.languageCode,
        label: sub.label
      });
    }

    muxArgs.push("-map", "0:v:0", "-map", "1:a:0");
    for (let i = 0; i < extraAudioInputs.length; i++) {
      muxArgs.push("-map", `${i + 2}:a:0`);
    }

    const subtitleOffset = 2 + extraAudioInputs.length;
    for (let i = 0; i < subtitleInputs.length; i++) {
      muxArgs.push("-map", `${subtitleOffset + i}:s:0`);
    }

    muxArgs.push("-c:v", "copy", "-c:a", "copy", "-shortest");

    if (subtitleInputs.length > 0) {
      muxArgs.push("-c:s", "srt");
    }

    const audioLabels = [primaryAudioLabel ?? "", ...extraAudioInputs.map(input => input.label)];
    for (const [i, label] of audioLabels.entries()) {
      if (label) {
        muxArgs.push(`-metadata:s:a:${i}`, `title=${label}`);
      }
    }

    for (const [i, sub] of subtitleInputs.entries()) {
      muxArgs.push(`-metadata:s:s:${i}`, `language=${sub.languageCode}`);

      if (sub.label) {
        muxArgs.push(`-metadata:s:s:${i}`, `title=${sub.label}`);
      }
    }

    muxArgs.push(outputFfmpegName);

    logPipelineEvent(`[ytdl:pipeline] final mux: ${1 + extraAudioInputs.length} audio track(s) ${subtitleInputs.length} subtitle(s)`);
    const muxExit = ffmpeg.exec(...muxArgs);
    if (muxExit !== 0) {
      throw new Error(`FFmpeg final mux failed (exit ${muxExit})`);
    }

    writtenPaths.push(outputFfmpegName);

    const outputBytes = ffmpeg.FS.readFile(outputFfmpegName, { encoding: "binary" });
    if (typeof outputBytes === "string") {
      throw new Error("FFmpeg readFile returned unexpected string output");
    }

    const recentContext = {
      videoId,
      title: item.metadata?.title ?? filenameOutput,
      channel: item.metadata?.artist ?? "",
      thumbnailUrl: item.metadata?.thumbnailUrl
    };
    await triggerDownload({
      data: outputBytes,
      filenameOutput: `${filenameBase}.${targetExt}`,
      recentContext
    });

    await reportProgress({
      videoId,
      progress: 1,
      progressType: ProgressType.FFmpeg,
      tabId
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
