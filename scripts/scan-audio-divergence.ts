import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { FFMPEG, FFPROBE, DOWNLOADS } from "./script-config.ts";

const [fileA, fileB, startArg, endArg] = process.argv.slice(2);
if (!fileA || !fileB || !startArg || !endArg) {
  console.error("Usage: bun scan-audio-divergence.ts <fileA> <fileB> <startSec> <endSec>");
  process.exit(1);
}

const FILE_A = fileA.includes("/") || fileA.includes("\\") ? fileA : join(DOWNLOADS, fileA);
const FILE_B = fileB.includes("/") || fileB.includes("\\") ? fileB : join(DOWNLOADS, fileB);
const START_SEC = parseFloat(startArg);
const END_SEC = parseFloat(endArg);
const WINDOW_MS = 200;

function audioRms(file: string, startSec: number, durSec: number): number | null {
  const r = spawnSync(FFMPEG, [
    "-ss", startSec.toFixed(3), "-t", durSec.toFixed(3),
    "-i", file, "-af", "astats=measure_perchannel=none",
    "-f", "null", "-"
  ], { encoding: "utf8", stdio: "pipe" });
  const m = /RMS level dB:\s*([-\d.]+)/.exec(r.stderr ?? "");
  return m ? parseFloat(m[1]!) : null;
}

function getAudioPackets(file: string, startSec: number, endSec: number) {
  const r = spawnSync(FFPROBE, [
    "-v", "quiet", "-select_streams", "a:0",
    "-show_packets", "-print_format", "csv", file
  ], { encoding: "utf8", stdio: "pipe", maxBuffer: 100 * 1024 * 1024 });
  return (r.stdout ?? "").split("\n")
    .filter(l => l.startsWith("packet,"))
    .map(l => { const p = l.split(","); return { pts: parseFloat(p[4]!), size: parseInt(p[9]!) }; })
    .filter(p => !isNaN(p.pts) && !isNaN(p.size) && p.pts >= startSec && p.pts <= endSec)
    .sort((a, b) => a.pts - b.pts);
}

console.log(`=== Audio RMS ${START_SEC}-${END_SEC}s (${WINDOW_MS}ms windows) ===`);
console.log(`t(s)\tA_RMS\tB_RMS\tDelta`);
for (let ms = START_SEC * 1000; ms <= END_SEC * 1000; ms += WINDOW_MS) {
  const t = ms / 1000;
  const a = audioRms(FILE_A, t, WINDOW_MS / 1000);
  const b = audioRms(FILE_B, t, WINDOW_MS / 1000);
  const delta = a !== null && b !== null ? Math.abs(a - b) : null;
  const marker = (a !== null && a < -35) ? " <<SILENT" : (delta !== null && delta > 5 ? " <<DIVERGE" : "");
  console.log(`${t.toFixed(3)}s\t${a?.toFixed(1) ?? "?"}\t${b?.toFixed(1) ?? "?"}\t${delta?.toFixed(1) ?? "?"}${marker}`);
}

const padSec = 2;
console.log(`\n=== File A audio packet gaps ${START_SEC - padSec}-${END_SEC + padSec}s ===`);
const packets = getAudioPackets(FILE_A, START_SEC - padSec, END_SEC + padSec);
console.log(`Total packets: ${packets.length}`);
for (let i = 1; i < packets.length; i++) {
  const gap = (packets[i]!.pts - packets[i - 1]!.pts) * 1000;
  if (gap > 40) {
    console.log(`  Gap at ${packets[i - 1]!.pts.toFixed(3)}s -> ${packets[i]!.pts.toFixed(3)}s (${gap.toFixed(0)}ms)`);
  }
}

console.log(`\n=== File A AV sync ${START_SEC - padSec}-${END_SEC + padSec}s ===`);
const r = spawnSync(FFPROBE, [
  "-v", "quiet", "-select_streams", "v:0",
  "-show_packets", "-print_format", "csv", FILE_A
], { encoding: "utf8", stdio: "pipe", maxBuffer: 100 * 1024 * 1024 });
const videoPts = (r.stdout ?? "").split("\n")
  .filter(l => l.startsWith("packet,"))
  .map(l => { const p = l.split(","); return parseFloat(p[4]!); })
  .filter(pts => !isNaN(pts) && pts >= START_SEC - padSec && pts <= END_SEC + padSec)
  .sort((a, b) => a - b);

const audioPts = packets.map(p => p.pts);
let maxDelta = 0;
for (const vpts of videoPts.filter((_, i) => i % 10 === 0)) {
  const nearest = audioPts.reduce((best, a) => Math.abs(a - vpts) < Math.abs(best - vpts) ? a : best);
  const delta = (nearest - vpts) * 1000;
  const marker = Math.abs(delta) > 50 ? " <<DRIFT" : "";
  console.log(`  video=${vpts.toFixed(3)}s nearest_audio=${nearest.toFixed(3)}s delta=${delta.toFixed(0)}ms${marker}`);
  if (Math.abs(delta) > maxDelta) maxDelta = Math.abs(delta);
}
console.log(`Max AV delta: ${maxDelta.toFixed(0)}ms`);
