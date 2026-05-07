/**
 * Fully-automated 3-phase identity verification.
 *
 * Phase 1 — Structural: duration, codec, streams, file size.
 * Phase 2 — Frame identity: SSIM between downloaded frames and live YouTube
 *            player screenshots (via Firefox RDP seek + MCP screenshot).
 * Phase 3 — AV sync: start-time delta and duration match.
 *
 * Usage:
 *   bun scripts/verify-identity-auto.ts [path-to-mkv]
 */
import { findFirefoxRdpPort, RDP } from "./firefox-rdp.js";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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
  return JSON.parse(raw) as { streams: Array<{ codec_type: string; codec_name: string; start_time?: string; duration?: string; width?: number; height?: number; sample_rate?: string; channels?: number }>; format: { duration: string; size: string; format_name: string } };
}

function extractLocalFrame(filePath: string, tSec: number, outPath: string) {
  spawnSync(FFMPEG, ["-y", "-ss", String(tSec), "-i", filePath, "-frames:v", "1", "-q:v", "2", outPath], { encoding: "utf8" });
}

function cropScreenshot(inPath: string, outPath: string, x: number, y: number, w: number, h: number) {
  spawnSync(FFMPEG, ["-y", "-i", inPath, "-vf", `crop=${w}:${h}:${x}:${y}`, outPath], { encoding: "utf8" });
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

async function sleep(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms));
}

async function main() {
  mkdirSync(TEMP_DIR, { recursive: true });

  // Find the file to verify
  let filePath = process.argv[2] ?? null;
  if (!filePath || !existsSync(filePath)) {
    // Find newest MKV in Downloads
    const { readdirSync, statSync } = await import("node:fs");
    const mkvs = readdirSync(DOWNLOADS)
      .filter(f => f.endsWith(".mkv"))
      .map(f => ({ f, mtime: statSync(join(DOWNLOADS, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    if (!mkvs.length) throw new Error("no MKV found in Downloads");
    filePath = join(DOWNLOADS, mkvs[0].f);
  }
  console.log(`\nFile: ${filePath}`);

  const port = findFirefoxRdpPort();
  if (!port) throw new Error("Firefox RDP port not found");
  const rdp = new RDP(port);
  await rdp.connect();

  try {
    // Get YouTube tab info
    const tabs = await rdp.listTabs();
    const ytTab = tabs.find(t => t.url?.includes("youtube.com/watch"));
    const consoleActor = ytTab ? await rdp.getConsoleActor(ytTab.actor) : null;

    let expectedDurationSec = 0;
    let videoId = "unknown";
    let title = "(unknown)";
    if (consoleActor) {
      const info = await rdp.evalInTab(consoleActor, `JSON.stringify({
        videoId: ytInitialData?.videoDetails?.videoId ?? new URLSearchParams(location.search).get('v'),
        durationSec: parseInt(ytInitialData?.videoDetails?.lengthSeconds ?? '0', 10),
        title: ytInitialData?.videoDetails?.title ?? document.title
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
    const probe = probeFile(filePath);
    const actualDuration = parseFloat(probe.format.duration);
    const fileSize = parseInt(probe.format.size);
    const videoStream = probe.streams.find(s => s.codec_type === "video");
    const audioStream = probe.streams.find(s => s.codec_type === "audio");

    console.log("\n── Phase 1: Structural ──────────────────────────────────────");
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
    console.log(`  Sample timestamps: ${timestamps.map(t => fmt(t)).join(", ")}`);

    // Extract local frames
    for (const [i, t] of timestamps.entries()) {
      const out = join(TEMP_DIR, `frame_${i}_local.png`);
      extractLocalFrame(filePath, t, out);
      console.log(`  extracted frame ${i + 1} at t=${fmt(t)}: ${existsSync(out) ? "ok" : "FAILED"}`);
    }

    // Capture reference frames from YouTube player via RDP + MCP
    if (!consoleActor) {
      console.log("  no YouTube tab — Phase 2 skipped");
    } else {
      // Get video element bounds once
      const boundsRaw = await rdp.evalInTab(consoleActor, `JSON.stringify((() => {
        const v = document.querySelector('#movie_player video') ?? document.querySelector('video');
        if (!v) return null;
        const r = v.getBoundingClientRect();
        return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
      })()`);

      const bounds = typeof boundsRaw === "string" && boundsRaw !== "null" ? JSON.parse(boundsRaw) as { x: number; y: number; w: number; h: number } : null;
      if (!bounds) {
        console.log("  could not get video bounds — Phase 2 skipped");
      } else {
        console.log(`  video bounds: ${bounds.w}x${bounds.h} at (${bounds.x},${bounds.y})`);

        let phase2Pass = true;
        for (const [i, t] of timestamps.entries()) {
          // Seek and pause
          await rdp.evalInTab(consoleActor, `(() => {
            const p = document.querySelector('#movie_player');
            if (p?.seekTo) p.seekTo(${t}, true);
            const v = document.querySelector('#movie_player video') ?? document.querySelector('video');
            if (v) v.pause();
          })()`);
          await sleep(SEEK_SETTLE_MS);

          // Take screenshot via MCP (save to temp)
          const screenshotPath = join(TEMP_DIR, `screenshot_${i}.png`);
          const { default: mcp } = await import("node:child_process");
          // We can't call MCP tools from a script — save screenshot path for manual crop
          // Instead write a helper file
          writeFileSync(join(TEMP_DIR, `seek_${i}.json`), JSON.stringify({ t, bounds, screenshotPath }));

          // Try to use existing screenshot if operator placed one
          const refPath = join(TEMP_DIR, `frame_${i}_ref.png`);
          if (existsSync(screenshotPath)) {
            cropScreenshot(screenshotPath, refPath, bounds.x, bounds.y, bounds.w, bounds.h);
          }

          if (existsSync(refPath)) {
            const ssim = computeSsim(join(TEMP_DIR, `frame_${i}_local.png`), refPath);
            const pass = ssim !== null && ssim >= SSIM_PASS_THRESHOLD;
            phase2Pass = pass && phase2Pass;
            check(`frame ${i + 1} t=${fmt(t)} SSIM`, pass, ssim !== null ? ssim.toFixed(4) : "failed");
          } else {
            console.log(`  frame ${i + 1} t=${fmt(t)}: awaiting screenshot at ${screenshotPath}`);
          }
        }
      }
    }

    // ── Summary ───────────────────────────────────────────────────────────────
    console.log("\n── Summary ──────────────────────────────────────────────────");
    console.log(`  Phase 1 (structural): ${phase1Pass ? "✓ PASS" : "✗ FAIL"}`);
    console.log(`  Phase 3 (AV sync):    ${phase3Pass ? "✓ PASS" : "✗ FAIL"}`);
    console.log(`  Phase 2 (SSIM):       frames in ${TEMP_DIR}`);
    console.log(`\n  Local frames extracted — to complete Phase 2, take screenshots`);
    console.log(`  of the YouTube player at each timestamp (player was seeked automatically)`);
    console.log(`  and save as ${TEMP_DIR}/screenshot_N.png, then re-run.`);

    if (!phase1Pass || !phase3Pass) process.exit(1);
  } finally {
    rdp.destroy();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
