import { findFirefoxRdpPort, RDP } from "./firefox-rdp.js";
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
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FFPROBE, FFMPEG, TEMP_DIR } from "./script-config";

const DURATION_TOLERANCE_SEC = 1;
const AV_SYNC_TOLERANCE_SEC = 0.1;
const AV_DURATION_MISMATCH_SEC = 0.5;
const MIN_FILE_SIZE_BYTES = 500_000;
const SSIM_PASS_THRESHOLD = 0.95;
const SAMPLE_OFFSETS = [0.10, 0.25, 0.50, 0.75, 0.90];

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
  format: {
    duration: string;
    size: string;
    format_name: string;
  };
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
  const raw = execFileSync(FFPROBE, [
    "-v", "error", "-of", "json",
    "-show_streams", "-show_format",
    filepath
  ], { encoding: "utf8" });
  const parsed: FfprobeOutput = JSON.parse(raw);
  return parsed;
}

function check(label: string, pass: boolean, detail: string): boolean {
  console.log(`  ${pass ? "✓" : "✗"}  ${label}: ${detail}`);
  return pass;
}

function formatDuration(totalSec: number): string {
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = Math.floor(totalSec % 60);
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

async function getMostRecentDownload(rdp: RDP): Promise<DownloadInfo | null> {
  const tabs = await rdp.listTabs();
  const downloadsTab = tabs.find(tab => tab.url === "about:downloads");
  if (!downloadsTab) {
    return null;
  }

  const consoleActor = await rdp.getConsoleActor(downloadsTab.actor);
  if (!consoleActor) {
    return null;
  }

  const result = await rdp.evalInTab(
    consoleActor, `(async () => {
    const { Downloads } = ChromeUtils.importESModule('resource://gre/modules/Downloads.sys.mjs');
    const list = await Downloads.getList(Downloads.ALL);
    const all = await list.getAll();
    const succeeded = all.filter(download => download.succeeded)
      .sort((first, second) => new Date(second.startTime).getTime() - new Date(first.startTime).getTime());
    const latest = succeeded[0];
    return latest ? JSON.stringify({ path: latest.target.path, size: latest.totalBytes }) : null;
  })()`
  );
  if (typeof result !== "string" || result === "null") {
    return null;
  }

  const parsed: DownloadInfo = JSON.parse(result);
  return parsed;
}

async function getYouTubeVideoInfo(rdp: RDP): Promise<YouTubeVideoInfo | null> {
  const tabs = await rdp.listTabs();
  const youtubeTab = tabs.find(tab => tab.url?.includes("youtube.com/watch"));
  if (!youtubeTab) {
    return null;
  }

  const consoleActor = await rdp.getConsoleActor(youtubeTab.actor);
  if (!consoleActor) {
    return null;
  }

  const result = await rdp.evalInTab(
    consoleActor, `JSON.stringify({
    videoId: ytInitialData?.videoDetails?.videoId ?? new URLSearchParams(location.search).get('v'),
    durationSec: parseInt(ytInitialData?.videoDetails?.lengthSeconds ?? '0', 10),
    title: ytInitialData?.videoDetails?.title ?? document.title
  })`
  );
  if (typeof result !== "string") {
    return null;
  }

  const parsed: YouTubeVideoInfo = JSON.parse(result);
  return parsed;
}

// ── Phase 1: structural probe ─────────────────────────────────────────────────

function runPhase1(probe: FfprobeOutput, download: DownloadInfo, expectedDurationSec: number): boolean {
  const actualDuration = parseFloat(probe.format.duration);
  const diff = Math.abs(actualDuration - expectedDurationSec);
  const videoStream = probe.streams.find(stream => stream.codec_type === "video");
  const audioStream = probe.streams.find(stream => stream.codec_type === "audio");

  console.log("\n── Phase 1: Structural probe ────────────────────────────────");
  let pass = true;

  pass = check("duration",
    diff <= DURATION_TOLERANCE_SEC,
    `${formatDuration(actualDuration)} vs ${formatDuration(expectedDurationSec)} expected (diff=${diff.toFixed(1)}s)`) && pass;

  pass = check("streams", probe.streams.length >= 2, `${probe.streams.length} stream(s) in ${probe.format.format_name}`) && pass;

  pass = check("video stream", Boolean(videoStream), videoStream ? `${videoStream.codec_name} ${videoStream.width}x${videoStream.height}` : "missing") && pass;

  pass = check("audio stream", Boolean(audioStream), audioStream ? `${audioStream.codec_name} ${audioStream.sample_rate}Hz ${audioStream.channels}ch` : "missing") && pass;

  pass = check("file size",
    download.size >= MIN_FILE_SIZE_BYTES,
    `${(download.size / 1_000_000).toFixed(1)} MB`) && pass;

  return pass;
}

// ── Phase 3: AV sync ──────────────────────────────────────────────────────────

function runPhase3(probe: FfprobeOutput): boolean {
  const videoStream = probe.streams.find(stream => stream.codec_type === "video");
  const audioStream = probe.streams.find(stream => stream.codec_type === "audio");

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
    `video=${videoStart.toFixed(3)}s audio=${audioStart.toFixed(3)}s diff=${startDiff.toFixed(3)}s`) && pass;

  const videoDur = parseFloat(videoStream.duration ?? probe.format.duration);
  const audioDur = parseFloat(audioStream.duration ?? probe.format.duration);
  const durDiff = Math.abs(videoDur - audioDur);

  pass = check("av duration match",
    durDiff <= AV_DURATION_MISMATCH_SEC,
    `video=${formatDuration(videoDur)} audio=${formatDuration(audioDur)} diff=${durDiff.toFixed(3)}s`) && pass;

  return pass;
}

// ── Phase 2: frame identity (SSIM) ───────────────────────────────────────────

function extractLocalFrame(filePath: string, timestampSec: number, outPath: string) {
  spawnSync(FFMPEG, [
    "-y",
    "-ss", String(timestampSec),
    "-i", filePath,
    "-frames:v", "1",
    "-q:v", "2",
    outPath
  ], { encoding: "utf8" });
}

function computeSsim(localFrame: string, refFrame: string): number | null {
  const result = spawnSync(FFMPEG, [
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
  const localFrames = timestamps.map((_timestamp, i) => join(TEMP_DIR, `frame_${i}_local.png`));

  console.log("\n── Phase 2: Frame identity (SSIM) ───────────────────────────");
  console.log(`  Extracting ${timestamps.length} frames from downloaded file...`);

  for (const [i, timestamp] of timestamps.entries()) {
    extractLocalFrame(filePath, timestamp, localFrames[i]);
    console.log(`  frame ${i + 1}: t=${formatDuration(timestamp)} → ${localFrames[i]}`);
  }

  console.log(
    `
  To capture reference frames from YouTube, for each timestamp below:
    1. Navigate Firefox to: https://www.youtube.com/watch?v=${videoId}
    2. Run in browser console: document.querySelector('#movie_player').seekTo(<t>, true)
    3. Run: document.querySelector('video').pause()
    4. Take a page screenshot and crop to the video element bounds using:
       ffmpeg -i screenshot.png -vf "crop=<w>:<h>:<x>:<y>" <ref_frame_path>

  Timestamps and expected reference frame paths:`
  );

  for (const [i, timestamp] of timestamps.entries()) {
    const refPath = join(TEMP_DIR, `frame_${i}_ref.png`);
    console.log(`    t=${formatDuration(timestamp)} (${timestamp}s) → ${refPath}`);
  }

  console.log(`\n  Checking for reference frames...`);

  let allSsimPass = true;
  let anyRefFound = false;

  for (const [i, timestamp] of timestamps.entries()) {
    const refPath = join(TEMP_DIR, `frame_${i}_ref.png`);
    if (!existsSync(refPath)) {
      console.log(`  frame ${i + 1} (t=${formatDuration(timestamp)}): ref not found — skipping`);
      continue;
    }

    anyRefFound = true;
    const ssim = computeSsim(localFrames[i], refPath);
    if (ssim === null) {
      console.log(`  ✗  frame ${i + 1} (t=${formatDuration(timestamp)}): SSIM computation failed`);
      allSsimPass = false;
    } else {
      const pass = ssim >= SSIM_PASS_THRESHOLD;
      console.log(`  ${pass ? "✓" : "✗"}  frame ${i + 1} (t=${formatDuration(timestamp)}): SSIM=${ssim.toFixed(4)} ${pass ? "≥" : "<"} ${SSIM_PASS_THRESHOLD} → ${pass ? "IDENTICAL" : "MISMATCH"}`);
      allSsimPass = allSsimPass && pass;
    }
  }

  if (!anyRefFound) {
    console.log(`  (no reference frames supplied — Phase 2 skipped)`);
    console.log(`  Place reference images in ${TEMP_DIR} and re-run to complete Phase 2.`);
    writeFileSync(
      join(TEMP_DIR, "timestamps.json"), JSON.stringify({
        videoId,
        timestamps
      }, null, 2)
    );
  } else if (allSsimPass) {
    console.log("\n  ✓ Phase 2: all sampled frames are IDENTICAL");
  } else {
    console.log("\n  ✗ Phase 2: frame mismatch detected — content differs from YouTube");
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const argVideoId = process.argv[2] ?? null;

  const port = findFirefoxRdpPort();
  if (!port) {
    throw new Error("Firefox RDP port not found");
  }

  const rdp = new RDP(port);
  await rdp.connect();

  try {
    const [ytInfo, download] = await Promise.all([
      getYouTubeVideoInfo(rdp).catch(() => null),
      getMostRecentDownload(rdp)
    ]);
    if (!download) {
      throw new Error("no completed download found in about:downloads");
    }

    const videoId = argVideoId ?? ytInfo?.videoId ?? "unknown";
    const expectedDurationSec = ytInfo?.durationSec ?? 0;

    console.log(`\nVideo: ${ytInfo?.title ?? videoId}`);
    console.log(`  videoId:   ${videoId}`);
    console.log(`  expected:  ${formatDuration(expectedDurationSec)}`);
    console.log(`\nFile: ${download.path}`);
    console.log(`  size:      ${(download.size / 1_000_000).toFixed(1)} MB`);

    const probe = probeFile(download.path);
    const actualDuration = parseFloat(probe.format.duration);

    const phase1Pass = runPhase1(probe, download, expectedDurationSec);
    const phase3Pass = runPhase3(probe);
    runPhase2(download.path, actualDuration, videoId);

    console.log("\n── Summary ──────────────────────────────────────────────────");
    console.log(`  Phase 1 (structural): ${phase1Pass ? "✓ PASS" : "✗ FAIL"}`);
    console.log(`  Phase 3 (AV sync):    ${phase3Pass ? "✓ PASS" : "✗ FAIL"}`);
    console.log(`  Phase 2 (SSIM):       run with reference frames in ${TEMP_DIR}`);

    if (!phase1Pass || !phase3Pass) {
      process.exit(1);
    }
  } finally {
    rdp.destroy();
  }
}

main().catch(err => {
  console.error(err); process.exit(1);
});
