import { waitForAdToClear } from "./scrub-ad-handler";
import { waitForBufferFill } from "./scrub-buffer-fill";
import { bindCaptureToVideoId } from "./scrub-capture";
import { waitForPlayerReady, forcePlayback, postAdSeek } from "./scrub-player";
import { scrubLog, sendEmptyResult, emitCapturedSegment } from "./scrub-segment-emit";
import { VIDEO_ELEMENT_SELECTOR } from "@/lib/youtube/player-selectors";

export { runTrustFactoryDrive } from "./scrub-trust-factory";

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

  scrubLog(`scrub start videoId=${videoId} index=${scrubIndex} window=${windowSec}s captureState=${window.__ytdlCapture ? "present" : "missing"}`);

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

  const hadAd = await waitForAdToClear();
  scrubLog(`ad cleared index=${scrubIndex} hadAd=${hadAd}`);

  // Never skip media fragments even after an ad: the addSourceBuffer hook
  // already clears ad bytes from pendingChunks when the main-content
  // SourceBuffer is created, so pendingChunks only holds valid main-content
  // data (from t=0 onward). Pre-trimming in the pipeline (-ss startSec)
  // extracts only the intended window, so we never need to discard media.
  bindCaptureToVideoId(videoId, false);
  scrubLog(`capture bound index=${scrubIndex} captureState=${window.__ytdlCapture ? "present" : "missing"}`);

  if (hadAd) {
    scrubLog(`post-ad seek to ${startSec}s index=${scrubIndex}`);
    postAdSeek(player, startSec);
  }

  await waitForBufferFill({
    videoId,
    windowSec,
    startSec,
    scrubIndex,
    player
  });
  player.pauseVideo?.();

  const elVideoAfterFill = document.querySelector<HTMLVideoElement>(VIDEO_ELEMENT_SELECTOR);
  const videoBufferStartSec = elVideoAfterFill?.buffered.length ? elVideoAfterFill.buffered.start(0) : undefined;

  const captured = window.__ytdlCapture?.capturedMedia.get(videoId);
  scrubLog(`buffer fill done index=${scrubIndex} audioBytes=${captured?.audioTotalBytes ?? 0} videoBytes=${captured?.videoTotalBytes ?? 0}`);

  if (!captured || captured.audioTotalBytes === 0) {
    scrubLog(`empty capture index=${scrubIndex}`);
    sendEmptyResult({
      videoId,
      scrubIndex
    });
    return;
  }

  scrubLog(`segment posting index=${scrubIndex} videoBytes=${captured.videoTotalBytes} audioBytes=${captured.audioTotalBytes}`);
  emitCapturedSegment({
    videoId,
    scrubIndex,
    captured,
    videoBufferStartSec
  });
  scrubLog(`segment posted index=${scrubIndex}`);
}
