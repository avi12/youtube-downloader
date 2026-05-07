import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { homedir } from "node:os";
import { FFPROBE, DOWNLOADS } from "./script-config";

const filename = process.argv[2] ?? "They're ACTUALLY Going to Fix Windows.mkv";
const filepath = filename.includes("/") || filename.includes("\\") ? filename : join(DOWNLOADS, filename);
const GAP_THRESHOLD_MS = 25;

const raw = execFileSync(FFPROBE, [
  "-v", "quiet",
  "-select_streams", "a:0",
  "-show_entries", "packet=pts_time,duration_time",
  "-of", "csv=p=0",
  filepath
], { encoding: "utf8", maxBuffer: 50 * 1024 * 1024 });

const lines = raw.split("\n");
let prevEnd: number | null = null;
const gaps: Array<[number, number, number]> = [];
let packetCount = 0;

for (const line of lines) {
  const parts = line.trim().split(",");
  if (parts.length < 2) continue;
  const pts = parseFloat(parts[0]!);
  const dur = parseFloat(parts[1]!);
  if (isNaN(pts) || isNaN(dur)) continue;
  packetCount++;
  if (prevEnd !== null) {
    const gapMs = (pts - prevEnd) * 1000;
    if (gapMs > GAP_THRESHOLD_MS) {
      gaps.push([prevEnd, pts, gapMs]);
    }
  }
  prevEnd = pts + dur;
}

console.log(`Scanned ${packetCount} audio packets`);
if (gaps.length === 0) {
  console.log(`NO GAPS > ${GAP_THRESHOLD_MS}ms found across entire audio stream`);
} else {
  console.log(`GAPS FOUND (${gaps.length}):`);
  for (const [start, end, ms] of gaps) {
    console.log(`  ${start.toFixed(3)}s -> ${end.toFixed(3)}s  gap=${ms.toFixed(1)}ms`);
  }
}
