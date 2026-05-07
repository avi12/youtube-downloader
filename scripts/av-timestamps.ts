/**
 * Extracts raw AV packet timestamps around segment boundaries to detect AV sync drift.
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { writeFileSync } from "node:fs";
import { FFPROBE, FFMPEG, DOWNLOADS } from "./script-config";

const CHROME = join(DOWNLOADS, process.argv[2] ?? "They're ACTUALLY Going to Fix Windows (1).mkv");
const FIREFOX = join(DOWNLOADS, process.argv[3] ?? "They're ACTUALLY Going to Fix Windows.mkv");

function getPacketTimestamps(file: string, streamIndex: number, startSec: number, endSec: number): number[] {
  const result = spawnSync(FFPROBE, [
    "-v", "quiet",
    "-select_streams", String(streamIndex),
    "-show_packets",
    "-print_format", "csv",
    file
  ], { encoding: "utf8", stdio: "pipe" });

  return (result.stdout ?? "")
    .split("\n")
    .filter(line => line.startsWith("packet,"))
    .map(line => {
      const parts = line.split(",");
      return parseFloat(parts[4]); // pts_time
    })
    .filter(t => !isNaN(t) && t >= startSec && t <= endSec);
}

// Extract a short WAV clip and compare RMS for finding temporal offset
function extractMono(file: string, startSec: number, durSec: number, outPath: string) {
  spawnSync(FFMPEG, [
    "-y", "-ss", startSec.toFixed(3), "-t", durSec.toFixed(3),
    "-i", file, "-vn", "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1", outPath
  ], { stdio: "pipe" });
}

function diffRms(pathA: string, pathB: string): number | null {
  const result = spawnSync(FFMPEG, [
    "-i", pathA, "-i", pathB,
    "-filter_complex", "[0:a][1:a]amix=inputs=2:normalize=0,astats=measure_perchannel=none",
    "-f", "null", "-"
  ], { encoding: "utf8", stdio: "pipe" });
  const match = /RMS level dB:\s*([-\d.]+)/.exec(result.stderr ?? "");
  return match ? parseFloat(match[1]) : null;
}

// Find temporal offset between Chrome and Firefox audio by sliding
function findOffset(tSec: number, windowSec = 3, searchMs = 200, stepMs = 10): { offset: number; rms: number } {
  const chromePath = `/tmp/ytdl_c_${tSec}.wav`;
  extractMono(CHROME, tSec - windowSec / 2, windowSec + searchMs / 1000 * 2, chromePath);

  let bestOffset = 0;
  let bestRms = -Infinity;
  for (let ms = -searchMs; ms <= searchMs; ms += stepMs) {
    const firefoxStart = tSec - windowSec / 2 + ms / 1000;
    if (firefoxStart < 0) continue;
    const firefoxPath = `/tmp/ytdl_f_${tSec}_${ms}.wav`;
    extractMono(FIREFOX, firefoxStart, windowSec, firefoxPath);
    const rms = diffRms(chromePath, firefoxPath);
    if (rms !== null && rms > bestRms) {
      bestRms = rms;
      bestOffset = ms;
    }
  }
  return { offset: bestOffset, rms: bestRms };
}

// Quick check: just compare audio RMS at exact timestamps to detect divergence
function audioRmsAt(file: string, startSec: number, durSec: number): number | null {
  const result = spawnSync(FFMPEG, [
    "-ss", startSec.toFixed(3), "-t", durSec.toFixed(3),
    "-i", file, "-af", "astats=measure_perchannel=none",
    "-f", "null", "-"
  ], { encoding: "utf8", stdio: "pipe" });
  const match = /RMS level dB:\s*([-\d.]+)/.exec(result.stderr ?? "");
  return match ? parseFloat(match[1]) : null;
}

// Find the first timestamp where Chrome and Firefox audio significantly diverge
console.log("Scanning 1-second windows for Chrome/Firefox audio divergence...");
console.log("t(s)    Chrome_RMS  Firefox_RMS  diff");
let firstDivergenceAt = -1;
for (let t = 30; t <= 80; t += 1) {
  const c = audioRmsAt(CHROME, t, 1);
  const f = audioRmsAt(FIREFOX, t, 1);
  if (c === null || f === null) continue;
  const diff = c - f;
  const diverging = Math.abs(diff) > 1.5;
  console.log(`${t}s\t${c.toFixed(2)}\t${f.toFixed(2)}\t${diff > 0 ? "+" : ""}${diff.toFixed(2)}${diverging ? " ***" : ""}`);
  if (diverging && firstDivergenceAt === -1) {
    firstDivergenceAt = t;
  }
}

if (firstDivergenceAt !== -1) {
  console.log(`\nFirst divergence at: ${firstDivergenceAt}s`);
  console.log(`\nLooking for temporal offset around ${firstDivergenceAt}s...`);

  // Search for temporal offset in 100ms steps around the divergence point
  const searchPoints = [firstDivergenceAt - 5, firstDivergenceAt, firstDivergenceAt + 5];
  for (const t of searchPoints) {
    const result = findOffset(t, 3, 500, 20);
    console.log(`  t=${t}s: best_offset=${result.offset > 0 ? "+" : ""}${result.offset}ms  diff_RMS=${result.rms.toFixed(2)}dB`);
  }
}
