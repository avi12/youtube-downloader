/**
 * Checks the raw Opus packet payload sizes in the Chrome and Firefox MKVs
 * near the 67.5-68.5s boundary to understand why near-silence frames survived stripping.
 * Uses -show_packets (not -show_frames) and correct CSV field indices.
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { FFPROBE, DOWNLOADS } from "./script-config";

const CHROME = join(DOWNLOADS, process.argv[2] ?? "They're ACTUALLY Going to Fix Windows (1).mkv");
const FIREFOX = join(DOWNLOADS, process.argv[3] ?? "They're ACTUALLY Going to Fix Windows.mkv");

// ffprobe -show_packets -print_format csv fields:
// packet,codec_type,stream_index,pts,pts_time,dts,dts_time,duration,duration_time,size,pos,flags
// parts: [0]=packet [1]=codec_type [2]=stream_index [3]=pts [4]=pts_time [5]=dts [6]=dts_time
//        [7]=duration [8]=duration_time [9]=size [10]=pos [11]=flags

function getPacketSizes(file: string, startSec: number, endSec: number): { pts: number; size: number }[] {
  const result = spawnSync(FFPROBE, [
    "-v", "quiet",
    "-select_streams", "a:0",
    "-show_packets",
    "-print_format", "csv",
    file
  ], { encoding: "utf8", stdio: "pipe", maxBuffer: 50 * 1024 * 1024 });

  return (result.stdout ?? "")
    .split("\n")
    .filter(line => line.startsWith("packet,"))
    .map(line => {
      const parts = line.split(",");
      return {
        pts: parseFloat(parts[4]),   // pts_time
        size: parseInt(parts[9])      // pkt_size
      };
    })
    .filter(f => !isNaN(f.pts) && !isNaN(f.size) && f.pts >= startSec && f.pts <= endSec);
}

function summarize(label: string, packets: { pts: number; size: number }[], silenceThreshold = 20) {
  console.log(`\n${label}:`);
  const sizeDist = new Map<number, number>();
  let silenceCount = 0;
  for (const pkt of packets) {
    sizeDist.set(pkt.size, (sizeDist.get(pkt.size) ?? 0) + 1);
    if (pkt.size <= silenceThreshold) silenceCount++;
  }

  // Show packets with small sizes
  for (const pkt of packets) {
    if (pkt.size <= silenceThreshold) {
      console.log(`  pts=${pkt.pts.toFixed(3)}s size=${pkt.size}B <<DTX?`);
    }
  }

  console.log(`  Total: ${packets.length} pkts, silence (≤${silenceThreshold}B): ${silenceCount}`);
  console.log("  Size distribution:");
  for (const [sz, count] of [...sizeDist.entries()].sort((a, b) => a[0] - b[0]).slice(0, 15)) {
    console.log(`    ${sz}B: ${count}×`);
  }
}

// Check boundary region
summarize("Chrome 67.5-68.5s", getPacketSizes(CHROME, 67.5, 68.5));
summarize("Firefox 67.5-68.5s", getPacketSizes(FIREFOX, 67.5, 68.5));

// Reference: no known boundary
summarize("Chrome 30-31s (reference)", getPacketSizes(CHROME, 30, 31));
summarize("Firefox 30-31s (reference)", getPacketSizes(FIREFOX, 30, 31));
