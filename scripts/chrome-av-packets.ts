/**
 * Extracts interleaved AV packet timestamps from Chrome MKV to measure
 * audio-video sync delta throughout the file, focused on 65-72s.
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { FFPROBE, DOWNLOADS } from "./script-config";

const CHROME = join(DOWNLOADS, process.argv[2] ?? "They're ACTUALLY Going to Fix Windows (1).mkv");

const result = spawnSync(FFPROBE, [
  "-v", "quiet",
  "-show_packets",
  "-print_format", "csv",
  CHROME
], { encoding: "utf8", stdio: "pipe", maxBuffer: 200 * 1024 * 1024 });

type Packet = { type: "v" | "a"; pts: number; duration: number };
const packets: Packet[] = (result.stdout ?? "")
  .split("\n")
  .filter(line => line.startsWith("packet,"))
  .map(line => {
    const parts = line.split(",");
    const streamIndex = parseInt(parts[2]);
    return {
      type: (streamIndex === 0 ? "v" : "a") as "v" | "a",
      pts: parseFloat(parts[4]),
      duration: parseFloat(parts[7])
    };
  })
  .filter(p => !isNaN(p.pts));

console.log(`Total packets: ${packets.length} (video: ${packets.filter(p => p.type === "v").length}, audio: ${packets.filter(p => p.type === "a").length})`);

// Extract sorted video and audio pts arrays
const videoPackets = packets.filter(p => p.type === "v" && p.pts >= 64 && p.pts <= 74).sort((a, b) => a.pts - b.pts);
const audioPackets = packets.filter(p => p.type === "a" && p.pts >= 64 && p.pts <= 74).sort((a, b) => a.pts - b.pts);

console.log(`\nChrome AV sync in 64-74s region: ${videoPackets.length} video, ${audioPackets.length} audio packets`);

// For each video frame, find the nearest audio packet and compute delta
console.log("\nvPTS(s)   aPTS(s)   delta(ms)");
for (const vPkt of videoPackets) {
  // Find the audio packet with the closest PTS
  let nearestAudio = audioPackets[0]!;
  for (const aPkt of audioPackets) {
    if (Math.abs(aPkt.pts - vPkt.pts) < Math.abs(nearestAudio.pts - vPkt.pts)) {
      nearestAudio = aPkt;
    }
  }
  const delta = (nearestAudio.pts - vPkt.pts) * 1000;
  const marker = Math.abs(delta) > 20 ? " ***" : "";
  console.log(`${vPkt.pts.toFixed(4)}  ${nearestAudio.pts.toFixed(4)}  ${delta > 0 ? "+" : ""}${delta.toFixed(1)}ms${marker}`);
}

// Also show audio packet gaps in the 64-74s region
console.log("\nAudio packet gaps in 64-74s:");
let prevPts = -1;
for (const pkt of audioPackets) {
  if (prevPts >= 0) {
    const expectedGap = 0.02; // 20ms Opus packets
    const actualGap = pkt.pts - prevPts;
    if (Math.abs(actualGap - expectedGap) > 0.005) {
      console.log(`  Gap at ${pkt.pts.toFixed(4)}s: prev=${prevPts.toFixed(4)}s actual_gap=${(actualGap*1000).toFixed(1)}ms (expected 20ms)`);
    }
  }
  prevPts = pkt.pts;
}
console.log("(no output above = no gaps > 5ms from expected 20ms)");
