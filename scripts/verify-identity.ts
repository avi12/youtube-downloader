/**
 * Runs the 3-phase identity verification protocol against a downloaded video.
 *
 * Phase 1 - Structural probe (ffprobe): duration, codec, streams, AV sync.
 * Phase 2 - Frame identity (FFmpeg SSIM): compares frames extracted from the
 *            downloaded file against reference screenshots captured from the
 *            YouTube player via MCP.
 * Phase 3 - AV sync: keyframe/audio PTS delta.
 *
 * Usage:
 *   bun scripts/verify-identity.ts [videoId] [stepSec]
 *
 * Outputs Phase 1 + Phase 3 results immediately, then extracts sample frames
 * and waits for the operator to supply reference screenshots (captured via MCP
 * by seeking the YouTube player to the printed timestamps). Once reference
 * images are placed in TEMP_DIR, SSIM comparison runs automatically.
 *
 * Reference images must be cropped to the video area only (the script prints
 * the exact FFmpeg crop command to use on the raw browser screenshot).
 */
import { execFileSync, spawnSync, execSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findFirefoxRdpPort, isFirefoxTab, isRecord, RDP } from "./firefox-rdp.js";

const DURATION_TOLERANCE_SEC = 1;
const AV_SYNC_TOLERANCE_SEC = 0.1;
const AV_DURATION_MISMATCH_SEC = 0.5;
const MIN_FILE_SIZE_BYTES = 500_000;
const SSIM_PASS_THRESHOLD = 0.95;
const SAMPLE_OFFSETS = [0.10, 0.25, 0.50, 0.75, 0.90];
const TEMP_DIR = join(tmpdir(), "ytdl-verify");

interface FfprobeStream {
  codec_type: string;
  codec_name: string;
  start_time?: string;
  duration?: string;
  width?: number;
  height?: number;
  sample_rate?: string;
  channels?: number;
}

interface FfprobeOutput {
  streams: FfprobeStream[];
  format: { duration: string; size: string; format_name: string };
}

interface DownloadInfo {
  path: string;
  size: number;
}

interface YouTubeVideoInfo {
  videoId: string;
  durationSec: number;
  title: string;
}

function probeFile(filepath: string): FfprobeOutput {
  const raw = execFileSync("ffprobe", [
    "-v", "error", "-of", "json",
    "-show_streams", "-show_format",
    filepath
  ], { encoding: "utf8" });
  return JSON.parse(raw) as FfprobeOutput;
}

function check(label: string, pass: boolean, detail: string): boolean {
  console.log(`  ${pass ? "✓" : "✗"}  ${label}: ${detail}`);
  return pass;
}

function formatDuration(totalSec: number): string {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = Math.floor(totalSec % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

function toFirefoxTabs(value: unknown) {
  return (Array.isArray(value) ? value : []).filter(isFirefoxTab);
}

async function getMostRecentDownload(rdp: RDP): Promise<DownloadInfo | null> {
  const listResp = await rdp.request("root", "listTabs");
  const dlTab = toFirefoxTabs(listResp.tabs).find(t => t.url === "about:downloads");
  if (!dlTab) return null;

  const target = await rdp.request(dlTab.actor, "getTarget");
  const frame = target.frame;
  if (!isRecord(frame) || typeof frame.consoleActor !== "string") return null;

  const result = await rdp.evalInTab(frame.consoleActor, `(async () => {
    const { Downloads } = ChromeUtils.importESModule('resource://gre/modules/Downloads.sys.mjs');
    const list = await Downloads.getList(Downloads.ALL);
    const all = await list.getAll();
    const succeeded = all.filter(dl => dl.succeeded)
      .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
    const dl = succeeded[0];
    return dl ? JSON.stringify({ path: dl.target.path, size: dl.totalBytes }) : null;
  })()`);

  if (typeof result !== "string" || result === "null") return null;
  return JSON.parse(result) as DownloadInfo;
}

async function getYouTubeVideoInfo(rdp: RDP): Promise<YouTubeVideoInfo | null> {
  const listResp = await rdp.request("root", "listTabs");
  const ytTab = toFirefoxTabs(listResp.tabs).find(t => t.url?.includes("youtube.com/watch"));
  if (!ytTab) return null;

  const target = await rdp.request(ytTab.actor, "getTarget");
  const frame = target.frame;
  if (!isRecord(frame) || typeof frame.consoleActor !== "string") return null;

  const result = await rdp.evalInTab(frame.consoleActor, `JSON.stringify({
    videoId: ytInitialData?.videoDetails?.videoId ?? new URLSearchParams(location.search).get('v'),
    durationSec: parseInt(ytInitialData?.videoDetails?.lengthSeconds ?? '0', 10),
    title: ytInitialData?.videoDetails?.title ?? document.title
  })`);

  if (typeof result !== "string") return null;
  return JSON.parse(result) as YouTubeVideoInfo;
}

// ── Phase 1: structural probe ─────────────────────────────────────────────────

function runPhase1(probe: FfprobeOutput, download: DownloadInfo, expectedDurationSec: number): boolean {
  const actualDuration = parseFloat(probe.format.duration);
  const diff = Math.abs(actualDuration - expectedDurationSec);
  const videoStream = probe.streams.find(s => s.codec_type === "video");
  const audioStream = probe.streams.find(s => s.codec_type === "audio");

  console.log("\n── Phase 1: Structural probe ────────────────────────────────");
  let pass = true;

  pass = check("duration",
    diff <= DURATION_TOLERANCE_SEC,
    `${formatDuration(actualDuration)} vs ${formatDuration(expectedDurationSec)} expected (diff=${diff.toFixed(1)}s)`
  ) && pass;

  pass = check("streams", probe.streams.length >= 2,
    `${probe.streams.length} stream(s) in ${probe.format.format_name}`
  ) && pass;

  pass = check("video stream", Boolean(videoStream),
    videoStream ? `${videoStream.codec_name} ${videoStream.width}x${videoStream.height}` : "missing"
  ) && pass;

  pass = check("audio stream", Boolean(audioStream),
    audioStream ? `${audioStream.codec_name} ${audioStream.sample_rate}Hz ${audioStream.channels}ch` : "missing"
  ) && pass;

  pass = check("file size",
    download.size >= MIN_FILE_SIZE_BYTES,
    `${(download.size / 1_000_000).toFixed(1)} MB`
  ) && pass;

  return pass;
}

// ── Phase 3: AV sync ──────────────────────────────────────────────────────────

function runPhase3(probe: FfprobeOutput): boolean {
  const videoStream = probe.streams.find(s => s.codec_type === "video");
  const audioStream = probe.streams.find(s => s.codec_type === "audio");

  console.log("\n── Phase 3: AV sync ─────────────────────────────────────────");

  if (!videoStream || !audioStream) {
    console.log("  skipped (missing streams)");
    return true;
  }

  let pass = true;
  const videoStart = parseFloat(videoStream.start_time ?? "0");
  const audioStart = parseFloat(audioStream.start_time ?? "0");
  const startDiff = Math.abs(videoStart - audioStart);

  pass = check("av start sync",
    startDiff <= AV_SYNC_TOLERANCE_SEC,
    `video=${videoStart.toFixed(3)}s audio=${audioStart.toFixed(3)}s diff=${startDiff.toFixed(3)}s`
  ) && pass;

  const videoDur = parseFloat(videoStream.duration ?? probe.format.duration);
  const audioDur = parseFloat(audioStream.duration ?? probe.format.duration);
  const durDiff = Math.abs(videoDur - audioDur);

  pass = check("av duration match",
    durDiff <= AV_DURATION_MISMATCH_SEC,
    `video=${formatDuration(videoDur)} audio=${formatDuration(audioDur)} diff=${durDiff.toFixed(3)}s`
  ) && pass;

  return pass;
}

// ── Phase 2: frame identity (SSIM) ───────────────────────────────────────────

function extractLocalFrame(filePath: string, timestampSec: number, outPath: string) {
  spawnSync("ffmpeg", [
    "-y",
    "-ss", String(timestampSec),
    "-i", filePath,
    "-frames:v", "1",
    "-q:v", "2",
    outPath
  ], { encoding: "utf8" });
}

function computeSsim(localFrame: string, refFrame: string): number | null {
  const result = spawnSync("ffmpeg", [
    "-i", localFrame,
    "-i", refFrame,
    "-lavfi", "[0:v]scale=320:180[a];[1:v]scale=320:180[b];[a][b]ssim=stats_file=-",
    "-f", "null", "-"
  ], { encoding: "utf8" });

  const match = /All:([\d.]+)/.exec(result.stderr ?? "");
  return match ? parseFloat(match[1]) : null;
}

function runPhase2(filePath: string, durationSec: number, videoId: string): void {
  mkdirSync(TEMP_DIR, { recursive: true });

  const timestamps = SAMPLE_OFFSETS.map(offset => Math.round(offset * durationSec));
  const localFrames = timestamps.map((t, i) => join(TEMP_DIR, `frame_${i}_local.png`));

  console.log("\n── Phase 2: Frame identity (SSIM) ───────────────────────────");
  console.log(`  Extracting ${timestamps.length} frames from downloaded file...`);

  for (const [i, t] of timestamps.entries()) {
    extractLocalFrame(filePath, t, localFrames[i]);
    console.log(`  frame ${i + 1}: t=${formatDuration(t)} → ${localFrames[i]}`);
  }

  console.log(`
  To capture reference frames from YouTube, for each timestamp below:
    1. Navigate Firefox to: https://www.youtube.com/watch?v=${videoId}
    2. Run in browser console: document.querySelector('#movie_player').seekTo(<t>, true)
    3. Run: document.querySelector('video').pause()
    4. Take a page screenshot and crop to the video element bounds using:
       ffmpeg -i screenshot.png -vf "crop=<w>:<h>:<x>:<y>" <ref_frame_path>

  Timestamps and expected reference frame paths:`);

  for (const [i, t] of timestamps.entries()) {
    const refPath = join(TEMP_DIR, `frame_${i}_ref.png`);
    console.log(`    t=${formatDuration(t)} (${t}s) → ${refPath}`);
  }

  console.log(`\n  Checking for reference frames...`);

  let allSsimPass = true;
  let anyRefFound = false;

  for (const [i, t] of timestamps.entries()) {
    const refPath = join(TEMP_DIR, `frame_${i}_ref.png`);
    if (!existsSync(refPath)) {
      console.log(`  frame ${i + 1} (t=${formatDuration(t)}): ref not found — skipping`);
      continue;
    }

    anyRefFound = true;
    const ssim = computeSsim(localFrames[i], refPath);
    if (ssim === null) {
      console.log(`  ✗  frame ${i + 1} (t=${formatDuration(t)}): SSIM computation failed`);
      allSsimPass = false;
    } else {
      const pass = ssim >= SSIM_PASS_THRESHOLD;
      console.log(`  ${pass ? "✓" : "✗"}  frame ${i + 1} (t=${formatDuration(t)}): SSIM=${ssim.toFixed(4)} ${pass ? "≥" : "<"} ${SSIM_PASS_THRESHOLD} → ${pass ? "IDENTICAL" : "MISMATCH"}`);
      allSsimPass = allSsimPass && pass;
    }
  }

  if (!anyRefFound) {
    console.log(`  (no reference frames supplied — Phase 2 skipped)`);
    console.log(`  Place reference images in ${TEMP_DIR} and re-run to complete Phase 2.`);
    writeFileSync(join(TEMP_DIR, "timestamps.json"), JSON.stringify({ videoId, timestamps }, null, 2));
  } else if (allSsimPass) {
    console.log("\n  ✓ Phase 2: all sampled frames are IDENTICAL");
  } else {
    console.log("\n  ✗ Phase 2: frame mismatch detected — content differs from YouTube");
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const argVideoId = process.argv[2] ?? null;
  const argStepSec = process.argv[3] ? parseInt(process.argv[3], 10) : null;

  const port = findFirefoxRdpPort();
  if (!port) throw new Error("Firefox RDP port not found");

  const rdp = new RDP(port);
  await rdp.connect();

  try {
    const [ytInfo, download] = await Promise.all([
      getYouTubeVideoInfo(rdp).catch(() => null),
      getMostRecentDownload(rdp)
    ]);

    if (!download) throw new Error("no completed download found in about:downloads");

    const videoId = argVideoId ?? ytInfo?.videoId ?? "unknown";
    const expectedDurationSec = ytInfo?.durationSec ?? 0;

    console.log(`\nVideo: ${ytInfo?.title ?? videoId}`);
    console.log(`  videoId:   ${videoId}`);
    console.log(`  expected:  ${formatDuration(expectedDurationSec)}`);
    console.log(`\nFile: ${download.path}`);
    console.log(`  size:      ${(download.size / 1_000_000).toFixed(1)} MB`);

    const probe = probeFile(download.path);
    const actualDuration = parseFloat(probe.format.duration);

    const p1 = runPhase1(probe, download, expectedDurationSec);
    const p3 = runPhase3(probe);
    runPhase2(download.path, actualDuration, videoId);

    console.log("\n── Summary ──────────────────────────────────────────────────");
    console.log(`  Phase 1 (structural): ${p1 ? "✓ PASS" : "✗ FAIL"}`);
    console.log(`  Phase 3 (AV sync):    ${p3 ? "✓ PASS" : "✗ FAIL"}`);
    console.log(`  Phase 2 (SSIM):       run with reference frames in ${TEMP_DIR}`);

    if (!p1 || !p3) process.exit(1);
  } finally {
    rdp.destroy();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
