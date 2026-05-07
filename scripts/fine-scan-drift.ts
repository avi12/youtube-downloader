/**
 * Fine-grained scan to find the exact timestamp where Chrome and Firefox audio diverge.
 * Also measures temporal offset (Chrome vs Firefox) on both sides of the divergence.
 */
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { FFMPEG, FFPROBE, DOWNLOADS } from "./script-config";

const CHROME = join(DOWNLOADS, process.argv[2] ?? "They're ACTUALLY Going to Fix Windows (1).mkv");
const FIREFOX = join(DOWNLOADS, process.argv[3] ?? "They're ACTUALLY Going to Fix Windows.mkv");
const TEMP = join(tmpdir(), "ytdl-fine");

mkdirSync(TEMP, { recursive: true });

function audioRms(file: string, startSec: number, durSec: number): number | null {
  const result = spawnSync(FFMPEG, [
    "-ss", startSec.toFixed(3), "-t", durSec.toFixed(3),
    "-i", file, "-af", "astats=measure_perchannel=none",
    "-f", "null", "-"
  ], { encoding: "utf8", stdio: "pipe" });
  const match = /RMS level dB:\s*([-\d.]+)/.exec(result.stderr ?? "");
  return match ? parseFloat(match[1]) : null;
}

function extractWav(file: string, startSec: number, durSec: number, outPath: string) {
  spawnSync(FFMPEG, [
    "-y", "-ss", startSec.toFixed(3), "-t", durSec.toFixed(3),
    "-i", file, "-vn", "-acodec", "pcm_s16le", "-ar", "48000", "-ac", "1", outPath
  ], { stdio: "pipe" });
}

// Fine scan: 200ms windows at 100ms steps around the divergence point
console.log("Fine scan [66.0s - 69.0s] at 100ms resolution, 200ms windows:");
console.log("t(s)    Chrome_RMS  Firefox_RMS  diff");
let firstDivAt = -1;
for (let ms = 66000; ms <= 69000; ms += 100) {
  const t = ms / 1000;
  const c = audioRms(CHROME, t, 0.2);
  const f = audioRms(FIREFOX, t, 0.2);
  if (c === null || f === null) continue;
  const diff = c - f;
  const diverging = Math.abs(diff) > 1.0;
  if (diverging && firstDivAt === -1) firstDivAt = t;
  console.log(`${t.toFixed(1)}s\t${c.toFixed(2)}\t${f.toFixed(2)}\t${diff > 0 ? "+" : ""}${diff.toFixed(2)}${diverging ? " ***" : ""}`);
}

if (firstDivAt > 0) {
  console.log(`\nFirst divergence at: ${firstDivAt.toFixed(1)}s`);
}

// Extract audio around the boundary from both files for duration comparison
console.log("\nExtracting audio: 65-80s from both files...");
const chromePath65 = `${TEMP}/chrome_65.wav`;
const firefoxPath65 = `${TEMP}/firefox_65.wav`;
extractWav(CHROME, 65, 15, chromePath65);
extractWav(FIREFOX, 65, 15, firefoxPath65);

// Measure actual audio duration to see if Chrome has different content length
function getWavDuration(path: string): number {
  const result = spawnSync(FFPROBE, [
    "-v", "quiet",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    path
  ], { encoding: "utf8", stdio: "pipe" });
  return parseFloat(result.stdout?.trim() ?? "0");
}

// Try to find temporal offset using sliding window cross-subtraction
// Extract a reference clip from Chrome at 64-67s (known good region)
console.log("\nSearching for temporal offset between 67-73s...");
const refPath = `${TEMP}/chrome_ref.wav`;
extractWav(CHROME, 64, 4, refPath);

// Slide Firefox in that range to find best match
let bestMs = 0;
let bestRms = -Infinity;
for (let offsetMs = -2000; offsetMs <= 2000; offsetMs += 50) {
  const firefoxStart = 64 + offsetMs / 1000;
  if (firefoxStart < 0) continue;
  const testPath = `${TEMP}/ff_test_${offsetMs}.wav`;
  extractWav(FIREFOX, firefoxStart, 4, testPath);

  const result = spawnSync(FFMPEG, [
    "-i", refPath, "-i", testPath,
    "-filter_complex",
    "[0:a]aformat=sample_fmts=fltp[a0];[1:a]aformat=sample_fmts=fltp,volume=-1[a1];[a0][a1]amix=inputs=2:normalize=0,astats=measure_perchannel=none",
    "-f", "null", "-"
  ], { encoding: "utf8", stdio: "pipe" });
  const match = /RMS level dB:\s*([-\d.]+)/.exec(result.stderr ?? "");
  const rms = match ? parseFloat(match[1]) : null;
  if (rms !== null && rms > bestRms) {
    bestRms = rms;
    bestMs = offsetMs;
  }
}
console.log(`Chrome at 64-68s matches Firefox at ${64 + bestMs / 1000}s (offset=${bestMs > 0 ? "+" : ""}${bestMs}ms, diff_RMS=${bestRms.toFixed(2)}dB)`);

// Now do the same for a segment AFTER the boundary
const ref2Path = `${TEMP}/chrome_ref2.wav`;
extractWav(CHROME, 71, 4, ref2Path);

let bestMs2 = 0;
let bestRms2 = -Infinity;
for (let offsetMs = -2000; offsetMs <= 2000; offsetMs += 50) {
  const firefoxStart = 71 + offsetMs / 1000;
  if (firefoxStart < 0) continue;
  const testPath = `${TEMP}/ff_test2_${offsetMs}.wav`;
  extractWav(FIREFOX, firefoxStart, 4, testPath);

  const result = spawnSync(FFMPEG, [
    "-i", ref2Path, "-i", testPath,
    "-filter_complex",
    "[0:a]aformat=sample_fmts=fltp[a0];[1:a]aformat=sample_fmts=fltp,volume=-1[a1];[a0][a1]amix=inputs=2:normalize=0,astats=measure_perchannel=none",
    "-f", "null", "-"
  ], { encoding: "utf8", stdio: "pipe" });
  const match = /RMS level dB:\s*([-\d.]+)/.exec(result.stderr ?? "");
  const rms = match ? parseFloat(match[1]) : null;
  if (rms !== null && rms > bestRms2) {
    bestRms2 = rms;
    bestMs2 = offsetMs;
  }
}
console.log(`Chrome at 71-75s matches Firefox at ${71 + bestMs2 / 1000}s (offset=${bestMs2 > 0 ? "+" : ""}${bestMs2}ms, diff_RMS=${bestRms2.toFixed(2)}dB)`);

console.log(`\nDrift change across boundary: ${bestMs2 - bestMs}ms`);
