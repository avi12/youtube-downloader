/**
 * Full 3-phase identity verification against the live YouTube source.
 *
 * Phase 1 - Structural: duration, codec, streams, file size.
 * Phase 2 - Frame identity: SSIM between extracted local frames and canvas-captured
 *            YouTube player frames at 5 sample offsets.
 * Phase 3 - AV sync: start-time delta and stream duration match.
 *
 * Usage: bun scripts/verify-identity-full.ts [path-to-mkv]
 */
import { findFirefoxRdpPort, RDP } from "./firefox-rdp.js";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { FFPROBE, FFMPEG, DOWNLOADS, TEMP_DIR } from "./script-config";
const SSIM_PASS_THRESHOLD = 0.95;
const SAMPLE_OFFSETS = [0.10, 0.25, 0.50, 0.75, 0.90];
const DURATION_TOLERANCE_SEC = 2;
const AV_SYNC_TOLERANCE_SEC = 0.1;
const AV_DURATION_MISMATCH_SEC = 0.5;
const MIN_FILE_SIZE_BYTES = 500_000;
const SEEK_SETTLE_MS = 3_000;

function check(label: string, pass: boolean, detail: string): boolean {
  console.log(`  ${pass ? "✓" : "✗"}  ${label}: ${detail}`);
  return pass;
}

function fmt(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = (totalSec % 60).toFixed(0).padStart(2, "0");
  return `${m}:${s}`;
}

function probeFile(path: string) {
  const raw = execFileSync(FFPROBE, [
    "-v", "error", "-of", "json", "-show_streams", "-show_format", path
  ], { encoding: "utf8" });
  return JSON.parse(raw) as {
    streams: Array<{
      codec_type: string; codec_name: string; start_time?: string;
      duration?: string; width?: number; height?: number;
      sample_rate?: string; channels?: number;
    }>;
    format: { duration: string; size: string; format_name: string };
  };
}

function extractLocalFrame(filePath: string, tSec: number, outPath: string) {
  spawnSync(FFMPEG, ["-y", "-ss", String(tSec), "-i", filePath, "-frames:v", "1", "-q:v", "2", outPath]);
}

function computeSsim(localFrame: string, refFrame: string): number | null {
  const result = spawnSync(FFMPEG, [
    "-i", localFrame, "-i", refFrame,
    "-lavfi", "[0:v]scale=320:180[a];[1:v]scale=320:180[b];[a][b]ssim=stats_file=-",
    "-f", "null", "-"
  ], { encoding: "utf8" });
  const match = /All:([\d.]+)/.exec(result.stderr ?? "");
  return match ? parseFloat(match[1]) : null;
}

async function captureRefFrames(
  rdp: RDP,
  consoleActor: string,
  timestamps: number[],
): Promise<void> {
  for (const [i, t] of timestamps.entries()) {
    console.log(`  seeking to ${fmt(t)} (${t}s)...`);

    await rdp.evalInTab(consoleActor, `(function() {
      var p = document.querySelector('#movie_player');
      if (p && p.seekTo) p.seekTo(${t}, true);
      setTimeout(function() {
        var v = document.querySelector('#movie_player video') || document.querySelector('video');
        if (v) v.pause();
      }, 1500);
    })()`);

    await wait(SEEK_SETTLE_MS);

    // Use synchronous toDataURL at 320x180 — small enough to return via RDP JSON
    const dataUrl = await rdp.evalInTab(consoleActor, `(function() {
      var v = document.querySelector('#movie_player video') || document.querySelector('video');
      if (!v) return null;
      var c = document.createElement('canvas');
      c.width = 320; c.height = 180;
      c.getContext('2d').drawImage(v, 0, 0, 320, 180);
      return c.toDataURL('image/png');
    })()`);

    if (!dataUrl || typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/png;base64,")) {
      console.log(`  frame ${i + 1}: capture failed (got: ${String(dataUrl).slice(0, 40)})`);
      continue;
    }

    const base64 = dataUrl.replace("data:image/png;base64,", "");
    const buf = Buffer.from(base64, "base64");
    const outPath = join(TEMP_DIR, `frame_${i}_ref.png`);
    writeFileSync(outPath, buf);
    console.log(`  frame ${i + 1} saved (${buf.length} bytes)`);
  }
}

async function main() {
  mkdirSync(TEMP_DIR, { recursive: true });

  let filePath = process.argv[2] ?? null;
  if (!filePath || !existsSync(filePath)) {
    const mkvs = readdirSync(DOWNLOADS)
      .filter(f => f.endsWith(".mkv"))
      .map(f => ({ f, mtime: statSync(join(DOWNLOADS, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    if (!mkvs.length) throw new Error("no MKV in Downloads");
    filePath = join(DOWNLOADS, mkvs[0].f);
  }
  console.log(`\nFile: ${filePath}`);

  const rdpPort = findFirefoxRdpPort();
  if (!rdpPort) throw new Error("Firefox RDP port not found");
  const rdp = new RDP(rdpPort);
  await rdp.connect();

  try {
    const tabs = await rdp.listTabs();
    const ytTab = tabs.find(t => t.url?.includes("youtube.com/watch"));
    const consoleActor = ytTab ? await rdp.getConsoleActor(ytTab.actor) : null;

    let expectedDurationSec = 0;
    let videoId = "unknown";
    let title = "(unknown)";

    if (consoleActor) {
      const info = await rdp.evalInTab(consoleActor, `JSON.stringify({
        videoId: (typeof ytInitialData !== 'undefined' && ytInitialData.videoDetails?.videoId) || new URLSearchParams(location.search).get('v'),
        durationSec: parseInt((typeof ytInitialData !== 'undefined' && ytInitialData.videoDetails?.lengthSeconds) || '0', 10),
        title: (typeof ytInitialData !== 'undefined' && ytInitialData.videoDetails?.title) || document.title
      })`);
      if (typeof info === "string") {
        const parsed = JSON.parse(info);
        videoId = parsed.videoId ?? "unknown";
        expectedDurationSec = parsed.durationSec ?? 0;
        title = parsed.title ?? "(unknown)";
      }
    }

    console.log(`Video: ${title} (${videoId})`);
    console.log(`Expected duration: ${fmt(expectedDurationSec)}`);

    // ── Phase 1 ───────────────────────────────────────────────────────────────
    console.log("\n── Phase 1: Structural ──────────────────────────────────────");
    const probe = probeFile(filePath);
    const actualDuration = parseFloat(probe.format.duration);
    const fileSize = parseInt(probe.format.size);
    const videoStream = probe.streams.find(s => s.codec_type === "video");
    const audioStream = probe.streams.find(s => s.codec_type === "audio");

    let phase1Pass = true;
    const durationDiff = Math.abs(actualDuration - expectedDurationSec);
    phase1Pass = check("duration",
      expectedDurationSec === 0 || durationDiff <= DURATION_TOLERANCE_SEC,
      `${fmt(actualDuration)} actual${expectedDurationSec ? ` vs ${fmt(expectedDurationSec)} expected (diff=${durationDiff.toFixed(1)}s)` : ""}`) && phase1Pass;
    phase1Pass = check("streams", probe.streams.length >= 2, `${probe.streams.length} in ${probe.format.format_name}`) && phase1Pass;
    phase1Pass = check("video", Boolean(videoStream), videoStream ? `${videoStream.codec_name} ${videoStream.width}x${videoStream.height}` : "missing") && phase1Pass;
    phase1Pass = check("audio", Boolean(audioStream), audioStream ? `${audioStream.codec_name} ${audioStream.sample_rate}Hz ${audioStream.channels}ch` : "missing") && phase1Pass;
    phase1Pass = check("file size", fileSize >= MIN_FILE_SIZE_BYTES, `${(fileSize / 1_000_000).toFixed(1)} MB`) && phase1Pass;

    // ── Phase 3 ───────────────────────────────────────────────────────────────
    console.log("\n── Phase 3: AV sync ─────────────────────────────────────────");
    let phase3Pass = true;
    if (videoStream && audioStream) {
      const vStart = parseFloat(videoStream.start_time ?? "0");
      const aStart = parseFloat(audioStream.start_time ?? "0");
      const startDiff = Math.abs(vStart - aStart);
      phase3Pass = check("av start delta",
        startDiff <= AV_SYNC_TOLERANCE_SEC,
        `video=${vStart.toFixed(3)}s audio=${aStart.toFixed(3)}s diff=${startDiff.toFixed(3)}s`) && phase3Pass;

      const vDur = parseFloat(videoStream.duration ?? probe.format.duration);
      const aDur = parseFloat(audioStream.duration ?? probe.format.duration);
      const durDiff = Math.abs(vDur - aDur);
      phase3Pass = check("av duration delta",
        durDiff <= AV_DURATION_MISMATCH_SEC,
        `video=${fmt(vDur)} audio=${fmt(aDur)} diff=${durDiff.toFixed(3)}s`) && phase3Pass;
    } else {
      console.log("  skipped (missing streams)");
    }

    // ── Phase 2 ───────────────────────────────────────────────────────────────
    console.log("\n── Phase 2: Frame identity (SSIM) ───────────────────────────");
    const timestamps = SAMPLE_OFFSETS.map(o => Math.round(o * actualDuration));
    console.log(`  Timestamps: ${timestamps.map(t => `${fmt(t)} (${t}s)`).join(", ")}`);

    console.log("  Extracting local frames from MKV...");
    for (const [i, t] of timestamps.entries()) {
      const outPath = join(TEMP_DIR, `frame_${i}_local.png`);
      extractLocalFrame(filePath, t, outPath);
      console.log(`  frame ${i + 1} t=${fmt(t)}: ${existsSync(outPath) ? "ok" : "FAILED"}`);
    }

    let phase2Pass = true;
    if (!consoleActor) {
      console.log("  no YouTube tab - Phase 2 skipped");
      phase2Pass = false;
    } else {
      console.log("  Capturing reference frames from YouTube player...");
      await captureRefFrames(rdp, consoleActor, timestamps);

      console.log("  Computing SSIM scores...");
      for (const [i, t] of timestamps.entries()) {
        const localPath = join(TEMP_DIR, `frame_${i}_local.png`);
        const refPath = join(TEMP_DIR, `frame_${i}_ref.png`);
        if (!existsSync(refPath)) {
          console.log(`  frame ${i + 1} t=${fmt(t)}: no reference frame`);
          phase2Pass = false;
          continue;
        }
        const ssim = computeSsim(localPath, refPath);
        const pass = ssim !== null && ssim >= SSIM_PASS_THRESHOLD;
        if (!pass) phase2Pass = false;
        check(`frame ${i + 1} t=${fmt(t)} SSIM`, pass, ssim !== null ? ssim.toFixed(4) : "failed");
      }
    }

    // ── Summary ───────────────────────────────────────────────────────────────
    console.log("\n── Summary ──────────────────────────────────────────────────");
    console.log(`  Phase 1 (structural): ${phase1Pass ? "✓ PASS" : "✗ FAIL"}`);
    console.log(`  Phase 2 (SSIM):       ${phase2Pass ? "✓ PASS" : "✗ FAIL"}`);
    console.log(`  Phase 3 (AV sync):    ${phase3Pass ? "✓ PASS" : "✗ FAIL"}`);

    const allPass = phase1Pass && phase2Pass && phase3Pass;
    console.log(`\n  Overall: ${allPass ? "✓ PASS - download matches YouTube source" : "✗ FAIL"}`);
    if (!allPass) process.exit(1);
  } finally {
    rdp.destroy();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
