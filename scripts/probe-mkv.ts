import { DOWNLOADS } from "./script-config.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const MKV_PATH = process.argv[2] ?? join(DOWNLOADS, "Nintendo is going to sue  - Anbernic RG DS(1).mkv");

const EBML_ID_INFO = 0x1549a966;
const EBML_ID_TRACKS = 0x1654ae6b;
const EBML_ID_DURATION = 0x4489;
const EBML_ID_TIMECODE_SCALE = 0x2ad7b1;
const EBML_ID_TRACK_ENTRY = 0xae;
const EBML_ID_TRACK_TYPE = 0x83;
const EBML_ID_CODEC_ID = 0x86;
const EBML_ID_CLUSTER = 0x1f43b675;
const EBML_ID_TIMESTAMP = 0xe7;

const NANOSECONDS_PER_SECOND = 1_000_000_000;
const DEFAULT_TIMECODE_SCALE = 1_000_000;
const EXPECTED_DURATION_SEC = 905;
const DURATION_TOLERANCE_SEC = 2;

const buf = readFileSync(MKV_PATH);
const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

function readVint(offset: number): {
  value: number;
  length: number;
} {
  const first = view.getUint8(offset);
  if (first === 0) {
    return {
      value: -1,
      length: 8
    };
  }

  let width = 1;
  let mask = 0x80;
  while (!(first & mask)) {
    width++; mask >>= 1;
  }
  let value = first & (mask - 1);
  for (let i = 1; i < width; i++) {
    value = (value * 256) + view.getUint8(offset + i);
  }
  return {
    value,
    length: width
  };
}

function readElementId(offset: number): {
  id: number;
  length: number;
} {
  const first = view.getUint8(offset);
  let width = 1;
  let mask = 0x80;
  while (!(first & mask)) {
    width++; mask >>= 1;
  }
  let id = first;
  for (let i = 1; i < width; i++) {
    id = (id << 8) | view.getUint8(offset + i);
  }
  return {
    id,
    length: width
  };
}

function readFloat(offset: number, size: number): number {
  if (size === 4) {
    return view.getFloat32(offset, false);
  }

  if (size === 8) {
    return view.getFloat64(offset, false);
  }

  return 0;
}

function readUint(offset: number, size: number): number {
  let val = 0;
  for (let i = 0; i < size; i++) {
    val = val * 256 + view.getUint8(offset + i);
  }
  return val;
}

function readString(offset: number, size: number): string {
  return Buffer.from(buf).subarray(offset, offset + size).toString("utf8").replace(/\0/g, "");
}

function scanElements(startOffset: number, endOffset: number): Map<number, {
  offset: number;
  size: number;
}[]> {
  const result = new Map<number, {
    offset: number;
    size: number;
  }[]>();
  let offset = startOffset;
  while (offset < endOffset && offset < buf.length) {
    const { id, length: idLen } = readElementId(offset);
    offset += idLen;

    if (offset >= buf.length) {
      break;
    }

    const sizeVint = readVint(offset);
    offset += sizeVint.length;
    const dataSize = sizeVint.value < 0 ? (endOffset - offset) : sizeVint.value;
    if (!result.has(id)) {
      result.set(id, []);
    }

    result.get(id)!.push({
      offset,
      size: dataSize
    });
    offset += dataSize;
  }
  return result;
}

// Skip EBML header
let offset = 0;
const { length: ebmlIdLen } = readElementId(offset);
offset += ebmlIdLen;
const ebmlSizeVint = readVint(offset);
offset += ebmlSizeVint.length + ebmlSizeVint.value;

// Find Segment
const { length: segIdLen } = readElementId(offset);
offset += segIdLen;
const segSizeVint = readVint(offset);
offset += segSizeVint.length;
const segEnd = segSizeVint.value < 0 ? buf.length : offset + segSizeVint.value;

const segElements = scanElements(offset, segEnd);

// Parse Info
let timecodeScale = DEFAULT_TIMECODE_SCALE;
let durationRaw = 0;
const infoEntry = segElements.get(EBML_ID_INFO)?.[0];
if (infoEntry) {
  const infoElements = scanElements(infoEntry.offset, infoEntry.offset + infoEntry.size);
  const tsEntry = infoElements.get(EBML_ID_TIMECODE_SCALE)?.[0];
  if (tsEntry) {
    timecodeScale = readUint(tsEntry.offset, tsEntry.size);
  }

  const durEntry = infoElements.get(EBML_ID_DURATION)?.[0];
  if (durEntry) {
    durationRaw = readFloat(durEntry.offset, durEntry.size);
  }
}

// Parse Tracks
interface TrackInfo { type: number;
  codecId: string; }
const tracks: TrackInfo[] = [];
const tracksEntry = segElements.get(EBML_ID_TRACKS)?.[0];
if (tracksEntry) {
  const tracksElements = scanElements(tracksEntry.offset, tracksEntry.offset + tracksEntry.size);
  for (const trackEntry of tracksElements.get(EBML_ID_TRACK_ENTRY) ?? []) {
    const trackFields = scanElements(trackEntry.offset, trackEntry.offset + trackEntry.size);
    const typeEntry = trackFields.get(EBML_ID_TRACK_TYPE)?.[0];
    const codecEntry = trackFields.get(EBML_ID_CODEC_ID)?.[0];
    tracks.push({
      type: typeEntry ? readUint(typeEntry.offset, typeEntry.size) : 0,
      codecId: codecEntry ? readString(codecEntry.offset, codecEntry.size) : ""
    });
  }
}

// First cluster timestamp
let firstClusterTimestampSec: number | null = null;
const firstCluster = segElements.get(EBML_ID_CLUSTER)?.[0];
if (firstCluster) {
  const clusterScanEnd = Math.min(firstCluster.offset + firstCluster.size, firstCluster.offset + 512);
  const clusterElements = scanElements(firstCluster.offset, clusterScanEnd);
  const tsEntry = clusterElements.get(EBML_ID_TIMESTAMP)?.[0];
  if (tsEntry) {
    firstClusterTimestampSec = (readUint(tsEntry.offset, tsEntry.size) * timecodeScale) / NANOSECONDS_PER_SECOND;
  }
}

const durationSec = (durationRaw * timecodeScale) / NANOSECONDS_PER_SECOND;
const fileSize = buf.length;

const TRACK_TYPE_VIDEO = 1;
const TRACK_TYPE_AUDIO = 2;
const videoTrack = tracks.find(track => track.type === TRACK_TYPE_VIDEO);
const audioTrack = tracks.find(track => track.type === TRACK_TYPE_AUDIO);

console.log("\n=== MKV Probe ===");
console.log(`File:         ${MKV_PATH}`);
console.log(`File size:    ${(fileSize / 1024 / 1024).toFixed(1)} MB`);
console.log(`Duration:     ${durationSec.toFixed(3)}s  (${Math.floor(durationSec / 60)}m${(durationSec % 60).toFixed(0)}s)`);
console.log(`TimecodeScale:${timecodeScale} ns`);
console.log(`Video codec:  ${videoTrack?.codecId ?? "(none)"}`);
console.log(`Audio codec:  ${audioTrack?.codecId ?? "(none)"}`);
console.log(`Tracks found: ${tracks.map(track => `type=${track.type} codec=${track.codecId}`).join(", ")}`);
console.log(`First cluster:${firstClusterTimestampSec !== null ? firstClusterTimestampSec.toFixed(3) + "s" : "(not found)"}`);

console.log("\n=== Phase 1: Structural ===");
const durationPass = Math.abs(durationSec - EXPECTED_DURATION_SEC) <= DURATION_TOLERANCE_SEC;
console.log(`  ${durationPass ? "✓" : "✗"}  Duration: ${durationSec.toFixed(1)}s (expected ~${EXPECTED_DURATION_SEC}s ±${DURATION_TOLERANCE_SEC}s)`);
const videoPass = !!videoTrack?.codecId;
console.log(`  ${videoPass ? "✓" : "✗"}  Video track: ${videoTrack?.codecId ?? "missing"}`);
const audioPass = !!audioTrack?.codecId;
console.log(`  ${audioPass ? "✓" : "✗"}  Audio track: ${audioTrack?.codecId ?? "missing"}`);
const sizePass = fileSize > 500_000;
console.log(`  ${sizePass ? "✓" : "✗"}  File size: ${(fileSize / 1024 / 1024).toFixed(1)} MB`);

const firstClusterPass = firstClusterTimestampSec !== null && firstClusterTimestampSec < 1;
console.log(`  ${firstClusterPass ? "✓" : "✗"}  First cluster timestamp: ${firstClusterTimestampSec?.toFixed(3) ?? "?"}s (expect <1s for proper AV start)`);

const allPass = durationPass && videoPass && audioPass && sizePass && firstClusterPass;
console.log(`\n${allPass ? "PASS" : "FAIL"}: Phase 1`);
