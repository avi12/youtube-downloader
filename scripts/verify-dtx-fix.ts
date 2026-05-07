/**
 * Verifies the DTX-fix download matches the Firefox reference.
 * Checks: duration/streams, AV sync (Chrome internal), audio content at drift boundary.
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { FFMPEG, FFPROBE, DOWNLOADS } from "./script-config";
const CHROME = join(DOWNLOADS, process.argv[2] ?? "fix-windows-chrome.mkv");
const FIREFOX = join(DOWNLOADS, process.argv[3] ?? "fix-windows-firefox.mkv");

function probe(file: string) {
  const r = spawnSync(FFPROBE, [
    "-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", file
  ], { encoding: "utf8", stdio: "pipe" });
  return JSON.parse(r.stdout ?? "{}");
}

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
  ], { encoding: "utf8", stdio: "pipe", maxBuffer: 50 * 1024 * 1024 });
  return (r.stdout ?? "").split("\n")
    .filter(l => l.startsWith("packet,"))
    .map(l => { const p = l.split(","); return { pts: parseFloat(p[4]!), size: parseInt(p[9]!) }; })
    .filter(p => !isNaN(p.pts) && !isNaN(p.size) && p.pts >= startSec && p.pts <= endSec);
}

function getVideoPackets(file: string, startSec: number, endSec: number) {
  const r = spawnSync(FFPROBE, [
    "-v", "quiet", "-select_streams", "v:0",
    "-show_packets", "-print_format", "csv", file
  ], { encoding: "utf8", stdio: "pipe", maxBuffer: 50 * 1024 * 1024 });
  return (r.stdout ?? "").split("\n")
    .filter(l => l.startsWith("packet,"))
    .map(l => { const p = l.split(","); return { pts: parseFloat(p[4]!) }; })
    .filter(p => !isNaN(p.pts) && p.pts >= startSec && p.pts <= endSec);
}

// === Phase 1: Duration + streams ===
console.log("=== PHASE 1: Structure ===");
const chromeInfo = probe(CHROME);
const firefoxInfo = probe(FIREFOX);
const chromeDur = parseFloat(chromeInfo.format?.duration ?? "0");
const firefoxDur = parseFloat(firefoxInfo.format?.duration ?? "0");
console.log(`Chrome  duration: ${chromeDur.toFixed(3)}s`);
console.log(`Firefox duration: ${firefoxDur.toFixed(3)}s`);
console.log(`Delta: ${Math.abs(chromeDur - firefoxDur).toFixed(3)}s`);
const chromeStreams = (chromeInfo.streams ?? []).map((s: { codec_type: string; codec_name: string }) => `${s.codec_type}(${s.codec_name})`).join(", ");
const firefoxStreams = (firefoxInfo.streams ?? []).map((s: { codec_type: string; codec_name: string }) => `${s.codec_type}(${s.codec_name})`).join(", ");
console.log(`Chrome  streams: ${chromeStreams}`);
console.log(`Firefox streams: ${firefoxStreams}`);

// === Phase 2: AV sync within Chrome (no drift at boundaries) ===
console.log("\n=== PHASE 2: Chrome AV sync 60-75s ===");
const chromAudio = getAudioPackets(CHROME, 60, 75).sort((a, b) => a.pts - b.pts);
const chromVideo = getVideoPackets(CHROME, 60, 75).sort((a, b) => a.pts - b.pts);
let maxDelta = 0;
let prevAudioPts = -1;
for (const vpkt of chromVideo) {
  const nearest = chromAudio.reduce((best, a) =>
    Math.abs(a.pts - vpkt.pts) < Math.abs(best.pts - vpkt.pts) ? a : best
  );
  const delta = Math.abs(nearest.pts - vpkt.pts) * 1000;
  if (delta > maxDelta) maxDelta = delta;
}
// Check for audio gaps in chrome
const chromAudio60_75 = chromAudio;
for (let i = 1; i < chromAudio60_75.length; i++) {
  const gap = (chromAudio60_75[i]!.pts - chromAudio60_75[i-1]!.pts) * 1000;
  if (gap > 100) {
    console.log(`  Audio gap at ${chromAudio60_75[i-1]!.pts.toFixed(3)}s -> ${chromAudio60_75[i]!.pts.toFixed(3)}s (${gap.toFixed(0)}ms)`);
  }
}
console.log(`Chrome max AV delta 60-75s: ${maxDelta.toFixed(0)}ms`);

// === Phase 3: Audio RMS comparison at drift boundary ===
console.log("\n=== PHASE 3: Audio RMS comparison 64-73s (1s windows) ===");
console.log("t(s)    Chrome_RMS   Firefox_RMS  Delta");
let maxRmsDelta = 0;
for (let t = 64; t <= 73; t++) {
  const c = audioRms(CHROME, t, 1);
  const f = audioRms(FIREFOX, t, 1);
  const delta = c !== null && f !== null ? Math.abs(c - f) : null;
  if (delta !== null && delta > maxRmsDelta) maxRmsDelta = delta;
  const marker = delta !== null && delta > 3 ? " <<DIVERGE" : "";
  console.log(`${t}s\t${c?.toFixed(1) ?? "?"}\t${f?.toFixed(1) ?? "?"}\t${delta?.toFixed(1) ?? "?"}${marker}`);
}

// === Phase 4: Fine scan at old drift point ===
console.log("\n=== PHASE 4: Fine scan 66.5-68.5s (200ms windows) ===");
console.log("t(s)       Chrome_RMS   Firefox_RMS  Delta");
for (let ms = 66500; ms <= 68500; ms += 200) {
  const t = ms / 1000;
  const c = audioRms(CHROME, t, 0.2);
  const f = audioRms(FIREFOX, t, 0.2);
  const delta = c !== null && f !== null ? Math.abs(c - f) : null;
  const marker = delta !== null && delta > 3 ? " <<DIVERGE" : "";
  console.log(`${t.toFixed(3)}s\t${c?.toFixed(1) ?? "?"}\t${f?.toFixed(1) ?? "?"}\t${delta?.toFixed(1) ?? "?"}${marker}`);
}

console.log(`\nMax RMS delta 64-73s: ${maxRmsDelta.toFixed(1)}dB`);
console.log(maxRmsDelta < 3 ? "PASS: audio matches at drift boundary" : "FAIL: audio diverges at drift boundary");
