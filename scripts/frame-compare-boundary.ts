/**
 * Compares video frames between Chrome and Firefox at the audio divergence boundary
 * (67-70s) to determine if the video content also differs.
 */
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdirSync, existsSync } from "node:fs";
import { FFMPEG, DOWNLOADS } from "./script-config";

const CHROME = join(DOWNLOADS, process.argv[2] ?? "They're ACTUALLY Going to Fix Windows (1).mkv");
const FIREFOX = join(DOWNLOADS, process.argv[3] ?? "They're ACTUALLY Going to Fix Windows.mkv");
const TEMP = join(tmpdir(), "ytdl-frames");

mkdirSync(TEMP, { recursive: true });

function extractFrame(file: string, timeSec: number, outPath: string) {
  const result = spawnSync(FFMPEG, [
    "-y", "-ss", timeSec.toFixed(3),
    "-i", file,
    "-frames:v", "1", "-q:v", "2",
    outPath
  ], { encoding: "utf8", stdio: "pipe" });
  return result.status === 0;
}

function ssim(pathA: string, pathB: string): number | null {
  const result = spawnSync(FFMPEG, [
    "-i", pathA, "-i", pathB,
    "-lavfi", "ssim",
    "-f", "null", "-"
  ], { encoding: "utf8", stdio: "pipe" });
  const match = /All:([\d.]+)/.exec(result.stderr ?? "");
  return match ? parseFloat(match[1]) : null;
}

const checkTimes = [65.0, 66.0, 67.0, 67.5, 68.0, 68.5, 69.0, 69.5, 70.0, 70.5, 71.0, 72.0];

console.log("Video frame SSIM comparison at segment boundary region:");
console.log("t(s)     SSIM    interpretation");

for (const t of checkTimes) {
  const chromePng = `${TEMP}/c_${t}.png`;
  const ffPng = `${TEMP}/f_${t}.png`;

  const cOk = extractFrame(CHROME, t, chromePng);
  const fOk = extractFrame(FIREFOX, t, ffPng);

  if (!cOk || !fOk) {
    console.log(`${t}s\t failed to extract`);
    continue;
  }

  const s = ssim(chromePng, ffPng);
  const interp = s === null ? "error" : s >= 0.999 ? "pixel-perfect" : s >= 0.95 ? "very similar" : s >= 0.80 ? "similar" : "DIFFERENT";
  console.log(`${t}s\t${s?.toFixed(4) ?? "null"}\t${interp}`);
}

// Also compare audio RMS at the same timestamps to show the difference
const FFPROBE = "ffprobe";
function audioRms(file: string, startSec: number): number | null {
  const result = spawnSync(FFMPEG, [
    "-ss", startSec.toFixed(3), "-t", "0.5",
    "-i", file, "-af", "astats=measure_perchannel=none",
    "-f", "null", "-"
  ], { encoding: "utf8", stdio: "pipe" });
  const match = /RMS level dB:\s*([-\d.]+)/.exec(result.stderr ?? "");
  return match ? parseFloat(match[1]) : null;
}

console.log("\nAudio RMS at same timestamps (0.5s windows):");
console.log("t(s)     Chrome   Firefox  diff");
for (const t of checkTimes) {
  const c = audioRms(CHROME, t);
  const f = audioRms(FIREFOX, t);
  const diff = c !== null && f !== null ? (c - f) : null;
  const marker = diff !== null && Math.abs(diff) > 1.0 ? " ***" : "";
  console.log(`${t}s\t${c?.toFixed(2) ?? "?"}\t${f?.toFixed(2) ?? "?"}\t${diff !== null ? `${diff > 0 ? "+" : ""}${diff.toFixed(2)}` : "?"}${marker}`);
}
