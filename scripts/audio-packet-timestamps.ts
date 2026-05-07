/**
 * Gets exact audio packet timestamps from Chrome and Firefox MKVs around the
 * divergence point (67-70s) to identify gaps or duplicates at segment boundaries.
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { FFPROBE, DOWNLOADS } from "./script-config";

const CHROME = join(DOWNLOADS, process.argv[2] ?? "They're ACTUALLY Going to Fix Windows (1).mkv");
const FIREFOX = join(DOWNLOADS, process.argv[3] ?? "They're ACTUALLY Going to Fix Windows.mkv");

function getAudioPackets(file: string): { pts: number; duration: number }[] {
  const result = spawnSync(FFPROBE, [
    "-v", "quiet",
    "-select_streams", "a:0",
    "-show_packets",
    "-print_format", "csv",
    file
  ], { encoding: "utf8", stdio: "pipe", maxBuffer: 100 * 1024 * 1024 });

  return (result.stdout ?? "")
    .split("\n")
    .filter(line => line.startsWith("packet,"))
    .map(line => {
      const parts = line.split(",");
      return {
        pts: parseFloat(parts[4]),
        duration: parseFloat(parts[7])
      };
    })
    .filter(p => !isNaN(p.pts));
}

function analyzeGaps(packets: { pts: number; duration: number }[], label: string, startSec: number, endSec: number) {
  const inRange = packets.filter(p => p.pts >= startSec && p.pts <= endSec);
  console.log(`\n${label}: audio packets ${startSec}s-${endSec}s (${inRange.length} packets)`);

  let prevEnd = -1;
  for (const pkt of inRange) {
    const gap = prevEnd >= 0 ? pkt.pts - prevEnd : 0;
    if (Math.abs(gap) > 0.025) {
      console.log(`  GAP at ${pkt.pts.toFixed(4)}s: prev_end=${prevEnd.toFixed(4)}s gap=${(gap * 1000).toFixed(1)}ms`);
    }
    prevEnd = pkt.pts + (isNaN(pkt.duration) ? 0.02 : pkt.duration);
  }

  if (inRange.length > 0) {
    const firstPts = inRange[0]!.pts;
    const lastPkt = inRange[inRange.length - 1]!;
    const coverage = (lastPkt.pts + (isNaN(lastPkt.duration) ? 0.02 : lastPkt.duration)) - firstPts;
    console.log(`  Coverage: ${firstPts.toFixed(4)}s to ${(firstPts + coverage).toFixed(4)}s (${coverage.toFixed(3)}s)`);
  }

  // Show packets around 67-70s boundary
  const boundary = inRange.filter(p => p.pts >= 66.5 && p.pts <= 69.5);
  if (boundary.length > 0 && boundary.length <= 200) {
    console.log(`  Packets 66.5-69.5s:`);
    for (const p of boundary) {
      console.log(`    pts=${p.pts.toFixed(4)}s  dur=${(p.duration * 1000).toFixed(1)}ms`);
    }
  }
}

console.log("Loading Chrome audio packets...");
const chromePackets = getAudioPackets(CHROME);
console.log(`Chrome: ${chromePackets.length} audio packets total`);

console.log("Loading Firefox audio packets...");
const ffPackets = getAudioPackets(FIREFOX);
console.log(`Firefox: ${ffPackets.length} audio packets total`);

analyzeGaps(chromePackets, "Chrome", 60, 80);
analyzeGaps(ffPackets, "Firefox", 60, 80);

// Compare packet timing: find the first point where Chrome and Firefox
// audio timestamps diverge by more than 50ms
console.log("\n=== Comparing packet timestamps ===");
const chromeRange = chromePackets.filter(p => p.pts >= 30 && p.pts <= 80);
const ffRange = ffPackets.filter(p => p.pts >= 30 && p.pts <= 80);

// Find divergence by looking at corresponding packets
const minLen = Math.min(chromeRange.length, ffRange.length);
for (let i = 0; i < minLen; i++) {
  const c = chromeRange[i]!;
  const f = ffRange[i]!;
  const delta = (c.pts - f.pts) * 1000;
  if (Math.abs(delta) > 30 || (i > 0 && i % 50 === 0)) {
    console.log(`  packet ${i}: Chrome=${c.pts.toFixed(4)}s Firefox=${f.pts.toFixed(4)}s delta=${delta > 0 ? "+" : ""}${delta.toFixed(1)}ms`);
    if (Math.abs(delta) > 30) break;
  }
}
