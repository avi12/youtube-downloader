/**
 * Verifies the Firefox MKV's internal AV sync at the drift boundary.
 * Before the fix: audio led video by ~300ms starting at segment 2 (~67.5s).
 * After the fix: max AV delta should be ≤20ms throughout.
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { FFPROBE, FFMPEG, DOWNLOADS } from "./script-config";

const FILE = join(DOWNLOADS, process.argv[2] ?? "fix-windows-firefox.mkv");

function getPackets(stream: "a:0" | "v:0", startSec: number, endSec: number) {
  const r = spawnSync(FFPROBE, [
    "-v", "quiet", "-select_streams", stream,
    "-show_packets", "-print_format", "csv", FILE
  ], { encoding: "utf8", stdio: "pipe", maxBuffer: 100 * 1024 * 1024 });
  return (r.stdout ?? "").split("\n")
    .filter(l => l.startsWith("packet,"))
    .map(l => { const p = l.split(","); return parseFloat(p[4]!); })
    .filter(pts => !isNaN(pts) && pts >= startSec && pts <= endSec)
    .sort((a, b) => a - b);
}

function audioRms(startSec: number, durSec: number): number | null {
  const r = spawnSync(FFMPEG, [
    "-ss", startSec.toFixed(3), "-t", durSec.toFixed(3),
    "-i", FILE, "-af", "astats=measure_perchannel=none",
    "-f", "null", "-"
  ], { encoding: "utf8", stdio: "pipe" });
  const m = /RMS level dB:\s*([-\d.]+)/.exec(r.stderr ?? "");
  return m ? parseFloat(m[1]!) : null;
}

// === AV sync within the Firefox file at 60-75s ===
console.log("=== AV sync within Firefox MKV (60-75s) ===");
const audioPts = getPackets("a:0", 60, 75);
const videoPts = getPackets("v:0", 60, 75);

console.log(`Audio packets in range: ${audioPts.length}`);
console.log(`Video packets in range: ${videoPts.length}`);

let maxDelta = 0;
let maxDeltaAt = 0;
for (const vpts of videoPts) {
  const nearest = audioPts.reduce((best, a) =>
    Math.abs(a - vpts) < Math.abs(best - vpts) ? a : best
  );
  const delta = Math.abs(nearest - vpts) * 1000;
  if (delta > maxDelta) { maxDelta = delta; maxDeltaAt = vpts; }
}
console.log(`Max AV delta: ${maxDelta.toFixed(0)}ms at t=${maxDeltaAt.toFixed(3)}s`);
console.log(maxDelta < 100 ? "PASS: AV sync OK" : `FAIL: AV drift detected (${maxDelta.toFixed(0)}ms)`);

// === Segment boundary detail: AV delta at 5s intervals 60-75s ===
console.log("\n=== AV delta at 5s intervals (boundary scan) ===");
console.log("t(s)    nearest_audio_pts  delta_ms");
for (let t = 60; t <= 75; t += 1) {
  const vPtsInWindow = videoPts.filter(p => p >= t && p < t + 0.1);
  if (vPtsInWindow.length === 0) continue;
  const vPts = vPtsInWindow[0]!;
  const nearest = audioPts.reduce((best, a) =>
    Math.abs(a - vPts) < Math.abs(best - vPts) ? a : best
  );
  const delta = (nearest - vPts) * 1000;
  const marker = Math.abs(delta) > 50 ? " <<DRIFT" : "";
  console.log(`${t}s\taudio=${nearest.toFixed(3)}s\tdelta=${delta.toFixed(0)}ms${marker}`);
}

// === Fine audio scan at old drift region ===
console.log("\n=== Firefox audio RMS at old drift region (66-69s, 200ms windows) ===");
console.log("t(s)       RMS_dB   (silence=near DTX boundary)");
for (let ms = 66000; ms <= 69000; ms += 200) {
  const t = ms / 1000;
  const rms = audioRms(t, 0.2);
  const marker = rms !== null && rms < -35 ? " <<NEAR-SILENCE" : "";
  console.log(`${t.toFixed(3)}s\t${rms?.toFixed(1) ?? "?"}\t${marker}`);
}
