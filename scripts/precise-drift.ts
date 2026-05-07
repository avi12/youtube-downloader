/**
 * Finds the temporal offset between Chrome and Firefox audio using PCM cross-correlation.
 * Extracts short WAV clips from Chrome and searches for them in Firefox using
 * FFmpeg's adelay/amix subtraction at high resolution (10ms steps).
 */
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdirSync, readFileSync, existsSync } from "node:fs";
import { FFMPEG, FFPROBE, DOWNLOADS } from "./script-config";

const CHROME = join(DOWNLOADS, process.argv[2] ?? "They're ACTUALLY Going to Fix Windows (1).mkv");
const FIREFOX = join(DOWNLOADS, process.argv[3] ?? "They're ACTUALLY Going to Fix Windows.mkv");
const TEMP = join(tmpdir(), "ytdl-precise");

mkdirSync(TEMP, { recursive: true });

function extractWav(file: string, startSec: number, durSec: number, outPath: string) {
  spawnSync(FFMPEG, [
    "-y", "-ss", startSec.toFixed(3), "-t", durSec.toFixed(3),
    "-i", file, "-vn", "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1", outPath
  ], { stdio: "pipe" });
}

// Returns RMS of (A - B) — closer to 0 (less negative) = better match
function subtractRms(pathA: string, pathB: string): number | null {
  const result = spawnSync(FFMPEG, [
    "-i", pathA, "-i", pathB,
    "-filter_complex",
    "[0:a]aformat=sample_fmts=fltp[a0];[1:a]aformat=sample_fmts=fltp,volume=-1[a1];[a0][a1]amix=inputs=2:normalize=0,astats=measure_perchannel=none",
    "-f", "null", "-"
  ], { encoding: "utf8", stdio: "pipe" });
  const match = /RMS level dB:\s*([-\d.]+)/.exec(result.stderr ?? "");
  return match ? parseFloat(match[1]) : null;
}

function findBestOffset(chromeSec: number, searchRangeMs: number, stepMs: number): { offset: number; rms: number } {
  const refPath = `${TEMP}/ref.wav`;
  extractWav(CHROME, chromeSec, 2, refPath);

  let bestOffset = 0;
  let bestRms = -Infinity;
  for (let ms = -searchRangeMs; ms <= searchRangeMs; ms += stepMs) {
    const ffSec = chromeSec + ms / 1000;
    if (ffSec < 0) continue;
    const testPath = `${TEMP}/ff_${ms}.wav`;
    extractWav(FIREFOX, ffSec, 2, testPath);
    const rms = subtractRms(refPath, testPath);
    if (rms !== null && rms > bestRms) {
      bestRms = rms;
      bestOffset = ms;
    }
  }
  return { offset: bestOffset, rms: bestRms };
}

// Check at multiple points before and after the divergence boundary
const checkPoints = [
  { t: 30, label: "early (30s)" },
  { t: 50, label: "mid seg1 (50s)" },
  { t: 62, label: "late seg1 (62s)" },
  { t: 65, label: "near boundary (65s)" },
  { t: 67, label: "at boundary (67s)" },
  { t: 70, label: "seg2 start (70s)" },
  { t: 75, label: "seg2 mid (75s)" },
  { t: 100, label: "seg3 (100s)" },
];

console.log("Chrome vs Firefox audio temporal offset search (100ms steps, ±2s range):");
console.log("t(s)  label                    offset   rms_diff");
for (const { t, label } of checkPoints) {
  const { offset, rms } = findBestOffset(t, 2000, 100);
  console.log(`${t}s\t${label.padEnd(25)}\t${offset > 0 ? "+" : ""}${offset}ms\t${rms.toFixed(2)}dB`);
}

// Fine search around the boundary at 10ms resolution
console.log("\nFine offset search ±500ms at 10ms steps:");
const finePoints = [62, 65, 68, 71, 74];
for (const t of finePoints) {
  const { offset, rms } = findBestOffset(t, 500, 10);
  console.log(`t=${t}s: offset=${offset > 0 ? "+" : ""}${offset}ms rms=${rms.toFixed(2)}dB`);
}
