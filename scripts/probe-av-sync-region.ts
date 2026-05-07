/**
 * Extracts AV packet timestamps from a region of an MKV file and computes
 * the running AV sync delta (audio PTS - video PTS) to find drift.
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { FFPROBE, FFMPEG, DOWNLOADS } from "./script-config";

const CHROME = join(DOWNLOADS, process.argv[2] ?? "They're ACTUALLY Going to Fix Windows (1).mkv");
const FIREFOX = join(DOWNLOADS, process.argv[3] ?? "They're ACTUALLY Going to Fix Windows.mkv");

function getPackets(file: string, startSec: number, durationSec: number, streamType: "v" | "a") {
  const result = spawnSync(FFPROBE, [
    "-read_intervals", `%+#1`,
    "-skip_frame", "noref",
    "-select_streams", streamType,
    "-read_intervals", `${startSec}%+${durationSec}`,
    "-show_packets",
    "-of", "csv=print_section=0",
    file
  ], { encoding: "utf8", stdio: "pipe" });
  return result.stdout ?? "";
}

function getPacketsFull(file: string, startSec: number, durationSec: number) {
  const result = spawnSync(FFPROBE, [
    "-select_streams", "v:0,a:0",
    "-read_intervals", `${startSec}%+${durationSec}`,
    "-show_packets",
    "-print_format", "csv",
    file
  ], { encoding: "utf8", stdio: "pipe" });
  return result.stdout ?? "";
}

// Parse CSV-format ffprobe packet output
// Fields: codec_type,stream_index,pts,pts_time,dts,dts_time,duration,duration_time,size,pos,flags
function parsePackets(csv: string) {
  return csv.split("\n")
    .filter(line => line.startsWith("packet,"))
    .map(line => {
      const parts = line.split(",");
      return {
        type: parts[1] === "0" ? "v" : "a",
        ptsTime: parseFloat(parts[4]),
        flags: parts[11] ?? ""
      };
    })
    .filter(p => !isNaN(p.ptsTime));
}

function analyzeAVSync(file: string, label: string, startSec: number, durationSec: number) {
  console.log(`\n=== ${label} [${startSec}s - ${startSec + durationSec}s] ===`);

  const raw = getPacketsFull(file, startSec, durationSec);
  const packets = parsePackets(raw);

  // Collect video and audio pts
  const videoPts = packets.filter(p => p.type === "v").map(p => p.ptsTime).sort((a, b) => a - b);
  const audioPts = packets.filter(p => p.type === "a").map(p => p.ptsTime).sort((a, b) => a - b);

  console.log(`  Video packets: ${videoPts.length}, Audio packets: ${audioPts.length}`);
  if (videoPts.length === 0 || audioPts.length === 0) {
    console.log("  No packets found in range");
    return;
  }

  console.log(`  Video range: ${videoPts[0].toFixed(3)}s - ${videoPts[videoPts.length - 1].toFixed(3)}s`);
  console.log(`  Audio range: ${audioPts[0].toFixed(3)}s - ${audioPts[audioPts.length - 1].toFixed(3)}s`);

  // Compute AV delta at regular video frame positions
  console.log("\n  Time(s)  | Nearest audio PTS | Delta(ms)");
  const sampleTimes = [startSec, startSec + durationSec * 0.25, startSec + durationSec * 0.5,
    startSec + durationSec * 0.75, startSec + durationSec - 0.5];
  for (const t of sampleTimes) {
    const nearestVideo = videoPts.find(p => p >= t);
    const nearestAudio = audioPts.find(p => p >= t);
    if (nearestVideo !== undefined && nearestAudio !== undefined) {
      const delta = (nearestAudio - nearestVideo) * 1000;
      console.log(`  ${nearestVideo.toFixed(3)}       | ${nearestAudio.toFixed(3)}            | ${delta > 0 ? "+" : ""}${delta.toFixed(1)}ms`);
    }
  }
}

// Also check audio content match between Chrome and Firefox at specific seconds
function extractAudio(file: string, startSec: number, durSec: number, outPath: string) {
  spawnSync(FFMPEG, [
    "-y", "-ss", String(startSec), "-t", String(durSec),
    "-i", file, "-vn", "-acodec", "pcm_s16le", "-ar", "48000", "-ac", "2", outPath
  ], { stdio: "pipe" });
}

function wavDuration(wavPath: string): number {
  const result = spawnSync(FFPROBE, [
    "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1",
    wavPath
  ], { encoding: "utf8", stdio: "pipe" });
  return parseFloat(result.stdout?.trim() ?? "0");
}

// Compare audio level to detect content differences at specific timestamps
function audioRmsAt(file: string, startSec: number, durSec: number): number | null {
  const result = spawnSync(FFMPEG, [
    "-ss", String(startSec), "-t", String(durSec),
    "-i", file, "-af", "astats=measure_perchannel=none",
    "-f", "null", "-"
  ], { encoding: "utf8", stdio: "pipe" });
  const match = /RMS level dB:\s*([-\d.]+)/.exec(result.stderr ?? "");
  return match ? parseFloat(match[1]) : null;
}

// Run analysis on Chrome MKV
console.log("Chrome MKV AV sync analysis (looking for drift at ~66s)");
console.log("==========================================================");

// Focus on the regions around segment boundaries and the reported drift point
analyzeAVSync(CHROME, "Chrome", 30, 15);   // end of seg0 boundary (35s)
analyzeAVSync(CHROME, "Chrome", 60, 15);   // reported drift region (~66s)
analyzeAVSync(CHROME, "Chrome", 65, 10);   // narrow window around 1:06
analyzeAVSync(CHROME, "Firefox", 60, 15);  // same region in Firefox for comparison

// Check audio RMS level at 66s to see if content diverges
console.log("\n=== Audio content comparison at 1:06 (66s) ===");
const timestamps = [60, 63, 66, 69, 72, 75];
for (const t of timestamps) {
  const chromeRms = audioRmsAt(CHROME, t, 2);
  const firefoxRms = audioRmsAt(FIREFOX, t, 2);
  const diff = (chromeRms !== null && firefoxRms !== null) ? (chromeRms - firefoxRms).toFixed(2) : "N/A";
  console.log(`  t=${t}s: Chrome=${chromeRms?.toFixed(2) ?? "?"} Firefox=${firefoxRms?.toFixed(2) ?? "?"} diff=${diff}`);
}
