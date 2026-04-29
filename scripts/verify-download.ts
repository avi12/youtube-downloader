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
import { execFileSync } from "node:child_process";

const DURATION_TOLERANCE_SEC = 3;
const MIN_FILE_SIZE_BYTES = 500_000;

// ── ffprobe ───────────────────────────────────────────────────────────────────

interface FfprobeStream {
  codec_type: string;
  codec_name: string;
}

interface FfprobeOutput {
  streams: FfprobeStream[];
  format: {
    duration: string;
    size: string;
    format_name: string;
  };
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
