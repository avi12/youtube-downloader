import { waitForAdToClear } from "./ad-handler";
import { waitForPlayerReady, forcePlayback, postAdSeek, wait } from "./player";
import { scrubLog, sendEmptyResult } from "./segment-emit";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";

export { runTrustFactoryDrive } from "./trust-factory";

// Small seeks (< ~140s) don't trigger a new SABR network request - the player
// serves from its buffer. Each iframe needs a seek large enough (>= 140s) to
// force a real SABR fetch and capture a session-credentialed template.
// Using (scrubIndex + offset) * windowSec staggers concurrent iframes so they
// seek to different positions, preventing server-side deduplication/throttling.
const SABR_PRIME_MIN_SEC = 140;
const SABR_PRIME_OFFSET_STEPS = 4;
const SABR_CAPTURE_WAIT_MS = 2_000;

export async function runScrubSelfDrive() {
  const params = new URLSearchParams(location.search);
  const scrubIndex = parseInt(params.get("ytdlScrubIndex") ?? "-1", 10);
  const videoId = params.get("v") ?? "";
  const windowSec = parseInt(params.get("ytdlScrubWindow") ?? "30", 10);
  const startSec = parseInt(params.get("t") ?? "0", 10);
  if (scrubIndex < 0 || !videoId) {
    scrubLog("missing scrub index or videoId");
    return;
  }

  scrubLog(`scrub start videoId=${videoId} index=${scrubIndex} startSec=${startSec} window=${windowSec}s`);

  const player = await waitForPlayerReady();
  if (!player) {
    scrubLog(`player never ready index=${scrubIndex}`);
    sendEmptyResult({
      videoId,
      scrubIndex
    });
    return;
  }

  scrubLog(`player ready index=${scrubIndex} duration=${player.getDuration?.() ?? 0}`);

  const isPlaying = await forcePlayback(player);
  if (!isPlaying) {
    scrubLog(`playback never started index=${scrubIndex}`);
    sendEmptyResult({
      videoId,
      scrubIndex
    });
    return;
  }

  scrubLog(`playback started index=${scrubIndex}`);

  await waitForAdToClear();
  scrubLog(`ad cleared index=${scrubIndex}`);

  const duration = player.getDuration?.() ?? 0;
  const maxSeekSec = Math.max(duration - 10, startSec);
  const rawPrimeSeekSec = (scrubIndex + SABR_PRIME_OFFSET_STEPS) * windowSec;
  const primeSeekSec = Math.max(
    Math.min(rawPrimeSeekSec, maxSeekSec),
    Math.min(SABR_PRIME_MIN_SEC, maxSeekSec)
  );
  postAdSeek(player, primeSeekSec);
  await wait(SABR_CAPTURE_WAIT_MS);

  // Delegate the actual byte-fetching to the MAIN world where fetch has
  // credentials and the SABR template is already captured. Result flows back
  // via CrossWorldMessage.IframeScrubSegment → scrub-result-forwarder → BG.
  scrubLog(`handing off to SABR fetch index=${scrubIndex} primeSeek=${primeSeekSec}s`);
  void crossWorldMessenger.sendMessage(CrossWorldMessage.RunScrubSabr, {
    videoId,
    scrubIndex,
    startSec,
    windowSec
  });
}
