/**
 * Measures timing offset between Chrome and Firefox MKV audio at specific timestamps.
 * Searches ±500ms in 20ms steps at each target, finds offset with minimum diff RMS.
 * Usage: bun scripts/find-audio-drift.ts
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FFMPEG, DOWNLOADS } from "./script-config";

const CHROME = join(DOWNLOADS, process.argv[2] ?? "They're ACTUALLY Going to Fix Windows (1).mkv");
const FIREFOX = join(DOWNLOADS, process.argv[3] ?? "They're ACTUALLY Going to Fix Windows.mkv");
const TEMP = join(tmpdir(), "ytdl-drift");

mkdirSync(TEMP, { recursive: true });

function extractWav(input: string, startSec: number, durationSec: number, outPath: string) {
  spawnSync(FFMPEG, [
    "-y", "-ss", String(startSec), "-t", String(durationSec),
    "-i", input, "-vn", "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1", outPath
  ], { stdio: "pipe" });
}

function diffRms(pathA: string, pathB: string): number | null {
  const result = spawnSync(FFMPEG, [
    "-i", pathA, "-i", pathB,
    "-filter_complex",
    "[0:a]aformat=sample_fmts=fltp[a0];[1:a]aformat=sample_fmts=fltp,volume=-1[a1];[a0][a1]amix=inputs=2:normalize=0,astats=measure_perchannel=none",
    "-f", "null", "-"
  ], { encoding: "utf8", stdio: "pipe" });
  const match = /RMS level dB: ([-\d.]+)/.exec(result.stderr ?? "");
  return match ? parseFloat(match[1]) : null;
}

const TARGETS = [10, 33, 66, 70, 105, 140, 200, 300];
const OFFSETS_MS = Array.from({ length: 51 }, (_, i) => (i - 25) * 20); // -500ms to +500ms, 20ms steps
const CLIP_SEC = 3;

console.log("Chrome vs Firefox audio timing drift analysis");
console.log("Searching ±500ms at each timestamp in 20ms steps\n");

for (const target of TARGETS) {
  const chromePath = `${TEMP}/c_${target}.wav`;
  extractWav(CHROME, target, CLIP_SEC, chromePath);

  if (!existsSync(chromePath)) {
    console.log(`t=${target}s: failed to extract Chrome clip`);
    continue;
  }

  let bestOffset = 0;
  let bestRms = -Infinity;

  for (const offsetMs of OFFSETS_MS) {
    const firefoxStart = target + offsetMs / 1000;
    if (firefoxStart < 0) continue;
    const firefoxPath = `${TEMP}/f_${target}_${offsetMs}.wav`;
    extractWav(FIREFOX, firefoxStart, CLIP_SEC, firefoxPath);
    const rms = diffRms(chromePath, firefoxPath);
    if (rms !== null && rms > bestRms) {
      bestRms = rms;
      bestOffset = offsetMs;
    }
  }

  // bestRms is least negative = smallest difference = best match
  console.log(`t=${target}s: best_offset=${bestOffset > 0 ? "+" : ""}${bestOffset}ms  diff_RMS=${bestRms.toFixed(2)}dB`);
}
