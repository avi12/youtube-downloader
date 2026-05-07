/**
 * Deep-dive into the 67.8-68.2s boundary to identify if Firefox has an audio gap,
 * or if Chrome has wrong-position audio at segment 2 start.
 */
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { FFMPEG, FFPROBE, DOWNLOADS } from "./script-config";

const CHROME = join(DOWNLOADS, process.argv[2] ?? "They're ACTUALLY Going to Fix Windows (1).mkv");
const FIREFOX = join(DOWNLOADS, process.argv[3] ?? "They're ACTUALLY Going to Fix Windows.mkv");
const TEMP = join(tmpdir(), "ytdl-boundary");

mkdirSync(TEMP, { recursive: true });

function audioRms(file: string, startSec: number, durSec: number): number | null {
  const result = spawnSync(FFMPEG, [
    "-ss", startSec.toFixed(4), "-t", durSec.toFixed(4),
    "-i", file, "-af", "astats=measure_perchannel=none",
    "-f", "null", "-"
  ], { encoding: "utf8", stdio: "pipe" });
  const match = /RMS level dB:\s*([-\d.]+)/.exec(result.stderr ?? "");
  return match ? parseFloat(match[1]) : null;
}

function extractWav(file: string, startSec: number, durSec: number, outPath: string) {
  spawnSync(FFMPEG, [
    "-y", "-ss", startSec.toFixed(4), "-t", durSec.toFixed(4),
    "-i", file, "-vn", "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1", outPath
  ], { stdio: "pipe" });
}

// Scan Firefox audio at 10ms granularity around 67.8-68.2s to find where the silence is
console.log("Firefox audio RMS at 10ms windows (67.6-68.6s):");
console.log("t(s)     Firefox_RMS  Chrome_RMS");
for (let ms = 67600; ms <= 68600; ms += 10) {
  const t = ms / 1000;
  const f = audioRms(FIREFOX, t, 0.01);
  const c = audioRms(CHROME, t, 0.01);
  const marker = f !== null && f < -35 ? " <<SILENT" : "";
  console.log(`${t.toFixed(3)}s\t${f?.toFixed(1) ?? "?"}\t${c?.toFixed(1) ?? "?"}${marker}`);
}

// Check if Firefox audio at 67.8s matches Chrome at a different time
// (to detect temporal offset)
console.log("\nSearching: does Chrome's audio at 67.8s appear in Firefox at another time?");
const chromeRef = `${TEMP}/chrome_678.wav`;
extractWav(CHROME, 67.8, 0.4, chromeRef);

// Try to find this snippet in Firefox from 66.0 to 70.0s
let bestMs = 0;
let bestRms = -Infinity;
for (let t = 66000; t <= 70000; t += 20) {
  const ffPath = `${TEMP}/ff_${t}.wav`;
  extractWav(FIREFOX, t / 1000, 0.4, ffPath);
  const result = spawnSync(FFMPEG, [
    "-i", chromeRef, "-i", ffPath,
    "-filter_complex",
    "[0:a]aformat=sample_fmts=fltp[a0];[1:a]aformat=sample_fmts=fltp,volume=-1[a1];[a0][a1]amix=inputs=2:normalize=0,astats=measure_perchannel=none",
    "-f", "null", "-"
  ], { encoding: "utf8", stdio: "pipe" });
  const match = /RMS level dB:\s*([-\d.]+)/.exec(result.stderr ?? "");
  const rms = match ? parseFloat(match[1]) : null;
  if (rms !== null && rms > bestRms) {
    bestRms = rms;
    bestMs = t;
  }
}
console.log(`Chrome at 67.8s best matches Firefox at ${bestMs / 1000}s (diff_RMS=${bestRms.toFixed(2)}dB)`);

// Also search: does Firefox at 67.8s appear elsewhere in Chrome?
console.log("\nSearching: does Firefox's audio at 67.8s appear in Chrome at another time?");
const ffRef = `${TEMP}/ff_678.wav`;
extractWav(FIREFOX, 67.8, 0.4, ffRef);

let bestMs2 = 0;
let bestRms2 = -Infinity;
for (let t = 66000; t <= 70000; t += 20) {
  const chromePath = `${TEMP}/c_${t}.wav`;
  extractWav(CHROME, t / 1000, 0.4, chromePath);
  const result = spawnSync(FFMPEG, [
    "-i", ffRef, "-i", chromePath,
    "-filter_complex",
    "[0:a]aformat=sample_fmts=fltp[a0];[1:a]aformat=sample_fmts=fltp,volume=-1[a1];[a0][a1]amix=inputs=2:normalize=0,astats=measure_perchannel=none",
    "-f", "null", "-"
  ], { encoding: "utf8", stdio: "pipe" });
  const match = /RMS level dB:\s*([-\d.]+)/.exec(result.stderr ?? "");
  const rms = match ? parseFloat(match[1]) : null;
  if (rms !== null && rms > bestRms2) {
    bestRms2 = rms;
    bestMs2 = t;
  }
}
console.log(`Firefox at 67.8s best matches Chrome at ${bestMs2 / 1000}s (diff_RMS=${bestRms2.toFixed(2)}dB)`);

// Check video frames at 67.8, 67.9, 68.0, 68.1 to see if video also has issues
function extractFrame(file: string, timeSec: number, outPath: string) {
  spawnSync(FFMPEG, [
    "-y", "-ss", timeSec.toFixed(3), "-i", file, "-frames:v", "1", outPath
  ], { stdio: "pipe" });
}

function ssim(a: string, b: string): number | null {
  const result = spawnSync(FFMPEG, [
    "-i", a, "-i", b, "-lavfi", "ssim", "-f", "null", "-"
  ], { encoding: "utf8", stdio: "pipe" });
  const match = /All:([\d.]+)/.exec(result.stderr ?? "");
  return match ? parseFloat(match[1]) : null;
}

console.log("\nVideo frame SSIM at 67.7-68.3s (10 frames):");
for (let ms = 67700; ms <= 68300; ms += 67) {
  const t = ms / 1000;
  const c = `${TEMP}/vc_${ms}.png`;
  const f = `${TEMP}/vf_${ms}.png`;
  extractFrame(CHROME, t, c);
  extractFrame(FIREFOX, t, f);
  const s = ssim(c, f);
  console.log(`${t.toFixed(3)}s: SSIM=${s?.toFixed(4) ?? "null"}`);
}
