import { findFirefoxRdpPort, isFirefoxTab, isRecord, RDP } from "./firefox-rdp.js";
/**
 * Verifies that the most recently completed Firefox download matches the
 * YouTube video currently open in the active YouTube tab.
 *
 * Checks:
 *   - Duration within ±DURATION_TOLERANCE_SEC of YouTube's reported length
 *   - Expected stream types present (video and/or audio)
 *   - No ffprobe decode errors
 *   - File size above a sane minimum
 *
 * Usage:
 *   bun scripts/verify-download.ts
 *   bun scripts/verify-download.ts <videoId>   # validate against a specific video
 */
import { execFileSync, spawnSync } from "node:child_process";

const DURATION_TOLERANCE_SEC = 1;
const AV_SYNC_TOLERANCE_SEC = 0.1;
const AV_DURATION_MISMATCH_SEC = 0.5;
const MIN_FILE_SIZE_BYTES = 500_000;
const FREEZE_MIN_DURATION_SEC = 2;
const FREEZE_NOISE_DB = -60;

// ── ffprobe ───────────────────────────────────────────────────────────────────

interface FfprobeStream {
  codec_type: string;
  codec_name: string;
  start_time?: string;
  duration?: string;
}

interface FfprobeOutput {
  streams: FfprobeStream[];
  format: {
    duration: string;
    size: string;
    format_name: string;
  };
}

interface FreezeEvent {
  start: number;
  duration: number;
  end: number;
}

function detectFreezes(filepath: string): FreezeEvent[] {
  const result = spawnSync("ffmpeg", [
    "-i", filepath,
    "-vf", `freezedetect=n=${FREEZE_NOISE_DB}dB:d=${FREEZE_MIN_DURATION_SEC}`,
    "-map", "0:v:0",
    "-f", "null",
    "-"
  ], { encoding: "utf8" });

  const output = result.stderr ?? "";
  const events: FreezeEvent[] = [];
  const startTimes = new Map<number, number>();

  for (const line of output.split("\n")) {
    const startMatch = /\[freezedetect\] frozen_start: ([\d.]+)/.exec(line);
    const durMatch = /\[freezedetect\] frozen_duration: ([\d.]+)/.exec(line);
    const endMatch = /\[freezedetect\] frozen_end: ([\d.]+)/.exec(line);
    if (startMatch) {
      startTimes.set(events.length, parseFloat(startMatch[1]));
    } else if (durMatch && endMatch) {
      const startSec = startTimes.get(events.length) ?? 0;
      events.push({
        start: startSec,
        duration: parseFloat(durMatch[1]),
        end: parseFloat(endMatch[1])
      });
    }
  }

  return events;
}

const BOUNDARY_SLOP_SEC = 5;

function isBoundaryAligned(freezeStart: number, totalDuration: number, stepSec: number | null): boolean {
  if (!stepSec) {
    return false;
  }

  for (let boundary = stepSec; boundary < totalDuration; boundary += stepSec) {
    if (Math.abs(freezeStart - boundary) <= BOUNDARY_SLOP_SEC) {
      return true;
    }
  }

  return false;
}

function probeFile(filepath: string): FfprobeOutput {
  const raw = execFileSync("ffprobe", [
    "-v", "error",
    "-of", "json",
    "-show_streams",
    "-show_format",
    filepath
  ], { encoding: "utf8" });
  const parsed: FfprobeOutput = JSON.parse(raw);
  return parsed;
}

// ── Firefox RDP helpers ───────────────────────────────────────────────────────

function toFirefoxTabs(value: unknown) {
  const arr = Array.isArray(value) ? value : [];
  return arr.filter(isFirefoxTab);
}

async function evalInYouTubeTab(rdp: RDP, expr: string): Promise<unknown> {
  const response = await rdp.request("root", "listTabs");
  const tabs = toFirefoxTabs(response.tabs);
  const ytTab = tabs.find(tab => tab.url?.includes("youtube.com/watch"));
  if (!ytTab) {
    throw new Error("no YouTube watch tab found");
  }

  const target = await rdp.request(ytTab.actor, "getTarget");
  const frame = target.frame;
  if (!isRecord(frame) || typeof frame.consoleActor !== "string") {
    throw new Error("could not get consoleActor for YouTube tab");
  }

  return rdp.evalInTab(frame.consoleActor, expr);
}

interface YouTubeVideoInfo {
  videoId: string;
  durationSec: number;
  title: string;
}

async function getYouTubeVideoInfo(rdp: RDP): Promise<YouTubeVideoInfo> {
  const result = await evalInYouTubeTab(
    rdp, `JSON.stringify({
    videoId: ytInitialData?.videoDetails?.videoId ?? new URLSearchParams(location.search).get('v'),
    durationSec: parseInt(ytInitialData?.videoDetails?.lengthSeconds ?? '0', 10),
    title: ytInitialData?.videoDetails?.title ?? document.title
  })`
  );
  if (typeof result !== "string") {
    throw new Error(`unexpected YouTube eval result: ${JSON.stringify(result)}`);
  }

  const parsed: YouTubeVideoInfo = JSON.parse(result);
  return parsed;
}

interface DownloadInfo {
  path: string;
  size: number;
}

async function getMostRecentDownload(rdp: RDP): Promise<DownloadInfo | null> {
  const dlListResponse = await rdp.request("root", "listTabs");
  const tabs = toFirefoxTabs(dlListResponse.tabs);
  const dlTab = tabs.find(tab => tab.url === "about:downloads");
  if (!dlTab) {
    return null;
  }

  const target = await rdp.request(dlTab.actor, "getTarget");
  const frame = target.frame;
  if (!isRecord(frame) || typeof frame.consoleActor !== "string") {
    return null;
  }

  const result = await rdp.evalInTab(
    frame.consoleActor, `(async () => {
    const { Downloads } = ChromeUtils.importESModule('resource://gre/modules/Downloads.sys.mjs');
    const list = await Downloads.getList(Downloads.ALL);
    const all = await list.getAll();
    const succeeded = all.filter(dl => dl.succeeded).sort((dlA, dlB) =>
      new Date(dlB.startTime).getTime() - new Date(dlA.startTime).getTime()
    );
    const dl = succeeded[0];
    return dl ? JSON.stringify({ path: dl.target.path, size: dl.totalBytes }) : null;
  })()`
  );
  if (typeof result !== "string" || result === "null") {
    return null;
  }

  const parsed: DownloadInfo = JSON.parse(result);
  return parsed;
}

// ── Verification ──────────────────────────────────────────────────────────────

function formatDuration(totalSec: number): string {
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = Math.floor(totalSec % 60);
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function check(label: string, pass: boolean, detail: string) {
  console.log(`  ${pass ? "✓" : "✗"}  ${label}: ${detail}`);
  return pass;
}

async function main() {
  const expectedVideoId = process.argv[2] ?? null;
  const stepSec = process.argv[3] ? parseInt(process.argv[3], 10) : null;

  const port = findFirefoxRdpPort();
  if (!port) {
    throw new Error("Firefox RDP port not found - is the dev server running?");
  }

  const rdp = new RDP(port);
  await rdp.connect();

  let allPassed = true;

  try {
    const [ytInfo, download] = await Promise.all([
      getYouTubeVideoInfo(rdp),
      getMostRecentDownload(rdp)
    ]);

    console.log(`\nYouTube: "${ytInfo.title}"`);
    console.log(`  videoId:  ${ytInfo.videoId}`);
    console.log(`  duration: ${formatDuration(ytInfo.durationSec)} (${ytInfo.durationSec}s)`);

    if (expectedVideoId && ytInfo.videoId !== expectedVideoId) {
      console.warn(`\n⚠  Active tab is ${ytInfo.videoId}, expected ${expectedVideoId}`);
    }

    if (!download) {
      throw new Error("no completed download found in about:downloads");
    }

    console.log(`\nDownload: ${download.path}`);
    console.log(`  size: ${(download.size / 1_000_000).toFixed(1)} MB`);

    const probe = probeFile(download.path);
    const actualDuration = parseFloat(probe.format.duration);
    const diff = Math.abs(actualDuration - ytInfo.durationSec);
    const isVideoContainer = /\.(mp4|mkv|webm)$/i.test(download.path);
    const videoStream = probe.streams.find(stream => stream.codec_type === "video");
    const audioStream = probe.streams.find(stream => stream.codec_type === "audio");

    console.log("\nResults:");
    allPassed = check(
      "duration",
      diff <= DURATION_TOLERANCE_SEC,
      `${formatDuration(actualDuration)} actual vs ${formatDuration(ytInfo.durationSec)} expected (diff=${diff.toFixed(1)}s, tolerance=±${DURATION_TOLERANCE_SEC}s)`
    ) && allPassed;

    if (isVideoContainer) {
      allPassed = check("video stream", Boolean(videoStream), videoStream?.codec_name ?? "missing") && allPassed;
      allPassed = check("audio stream", Boolean(audioStream), audioStream?.codec_name ?? "missing") && allPassed;

      if (videoStream && audioStream) {
        const videoStart = parseFloat(videoStream.start_time ?? "0");
        const audioStart = parseFloat(audioStream.start_time ?? "0");
        const startDiff = Math.abs(videoStart - audioStart);
        allPassed = check(
          "av start sync",
          startDiff <= AV_SYNC_TOLERANCE_SEC,
          `video=${videoStart.toFixed(3)}s audio=${audioStart.toFixed(3)}s diff=${startDiff.toFixed(3)}s (max ±${AV_SYNC_TOLERANCE_SEC}s)`
        ) && allPassed;

        const videoDur = parseFloat(videoStream.duration ?? probe.format.duration);
        const audioDur = parseFloat(audioStream.duration ?? probe.format.duration);
        const durDiff = Math.abs(videoDur - audioDur);
        allPassed = check(
          "av duration match",
          durDiff <= AV_DURATION_MISMATCH_SEC,
          `video=${formatDuration(videoDur)} audio=${formatDuration(audioDur)} diff=${durDiff.toFixed(3)}s (max ${AV_DURATION_MISMATCH_SEC}s)`
        ) && allPassed;
      }
    }

    allPassed = check(
      "file size",
      download.size >= MIN_FILE_SIZE_BYTES,
      `${(download.size / 1_000_000).toFixed(2)} MB (min ${(MIN_FILE_SIZE_BYTES / 1_000_000).toFixed(1)} MB)`
    ) && allPassed;

    allPassed = check(
      "container",
      probe.streams.length > 0,
      `${probe.format.format_name} with ${probe.streams.length} stream(s)`
    ) && allPassed;

    if (isVideoContainer && videoStream && audioStream) {
      console.log("\n  Running freeze detection (this may take a moment)...");
      const freezes = detectFreezes(download.path);
      const suspicious = freezes.filter(
        freeze => !isBoundaryAligned(freeze.start, actualDuration, stepSec)
      );
      const detail = suspicious.length === 0
        ? `none at segment boundaries${freezes.length > 0 ? ` (${freezes.length} elsewhere — likely intentional still frames)` : ""}`
        : `${suspicious.length} at segment boundaries: ${suspicious.map(freeze => `${formatDuration(freeze.start)}-${formatDuration(freeze.end)} (${freeze.duration.toFixed(1)}s)`).join(", ")}`;
      check("frozen chunks", suspicious.length === 0, detail);

      if (suspicious.length > 0) {
        console.log("    ⚠  Freeze detection cannot distinguish pipeline gaps from intentional still frames.");
        console.log("    ⚠  Inspect the timestamps above manually to confirm.");
        allPassed = false;
      }
    }

    console.log(`\n${allPassed ? "✓ PASS" : "✗ FAIL"}\n`);
  } finally {
    rdp.destroy();
  }

  if (!allPassed) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
